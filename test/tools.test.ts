import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SleeperApi } from '../src/api.js';
import { DiskCache } from '../src/cache.js';
import { createServer } from '../src/index.js';
import { PlayerIndex } from '../src/players.js';
import { makeFetchStub } from './fixtures.js';

/**
 * These drive the server through a real MCP client over an in-memory transport,
 * so tool registration, schema validation and serialization are all exercised —
 * not just the handler bodies.
 */

let cacheDir: string;
let client: Client;
let calls: string[];

async function connect(opts: { notFound?: string[] } = {}) {
  const stub = makeFetchStub(opts);
  calls = stub.calls;
  const api = new SleeperApi({ fetchImpl: stub.fetch });
  // Point the player map at a throwaway dir so tests never touch the real cache.
  Object.assign(api, { players: new PlayerIndex(api.client, 'nfl', new DiskCache(cacheDir)) });

  const server = createServer(api);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'test', version: '0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
}

/** Calls a tool and returns its parsed JSON payload. */
async function callJson(name: string, args: Record<string, unknown> = {}): Promise<any> {
  const result = (await client.callTool({ name, arguments: args })) as {
    content: { type: string; text: string }[];
    isError?: boolean;
  };
  expect(result.isError, `${name} returned an error: ${result.content[0]?.text}`).toBeFalsy();
  return JSON.parse(result.content[0].text);
}

async function callRaw(name: string, args: Record<string, unknown> = {}) {
  return (await client.callTool({ name, arguments: args })) as {
    content: { type: string; text: string }[];
    isError?: boolean;
  };
}

beforeEach(async () => {
  cacheDir = await mkdtemp(join(tmpdir(), 'sleeper-tools-'));
  await connect();
});

afterEach(async () => {
  await client.close();
  await rm(cacheDir, { recursive: true, force: true });
});

describe('server surface', () => {
  it('registers every tool', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        'sleeper_find_leagues',
        'sleeper_get_draft',
        'sleeper_get_draft_board',
        'sleeper_get_draft_picks',
        'sleeper_get_draft_traded_picks',
        'sleeper_get_league',
        'sleeper_get_league_drafts',
        'sleeper_get_league_rosters',
        'sleeper_get_league_users',
        'sleeper_get_matchup_report',
        'sleeper_get_matchups',
        'sleeper_get_nfl_state',
        'sleeper_get_player_data_status',
        'sleeper_get_playoff_bracket',
        'sleeper_refresh_players',
        'sleeper_get_roster',
        'sleeper_get_standings',
        'sleeper_get_traded_picks',
        'sleeper_get_transaction_feed',
        'sleeper_get_transactions',
        'sleeper_get_trending_players',
        'sleeper_get_user',
        'sleeper_get_user_drafts',
        'sleeper_get_user_leagues',
        'sleeper_lookup_players',
        'sleeper_search_players',
      ].sort(),
    );
  });

  it('marks every tool read-only except the player-cache refresh', async () => {
    const { tools } = await client.listTools();
    const writers = tools.filter((t) => t.annotations?.readOnlyHint !== true).map((t) => t.name);
    // Nothing in this server can change anything at Sleeper; refresh is flagged
    // only because it rewrites the local player-map cache.
    expect(writers).toEqual(['sleeper_refresh_players']);
  });

  it('exposes the NFL state resource', async () => {
    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri)).toContain('sleeper://nfl/state');
    const read = await client.readResource({ uri: 'sleeper://nfl/state' });
    expect(JSON.parse(read.contents[0].text as string).season).toBe('2025');
  });
});

describe('raw tools', () => {
  it('gets a user', async () => {
    expect(await callJson('sleeper_get_user', { username_or_id: 'alice' })).toMatchObject({ user_id: 'u1' });
  });

  it('returns a readable error for an unknown username', async () => {
    const result = await callRaw('sleeper_get_user', { username_or_id: 'ghost' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('no data');
  });

  it('trims a league by default and keeps everything when verbose', async () => {
    const trimmed = await callJson('sleeper_get_league', { league_id: '999' });
    expect(trimmed.scoring_format).toBe('PPR');
    expect(trimmed.scoring_settings).not.toHaveProperty('blk_kick');

    const full = await callJson('sleeper_get_league', { league_id: '999', verbose: true });
    expect(full.scoring_settings).toHaveProperty('blk_kick');
  });

  it('rejects an out-of-range week before making a request', async () => {
    const before = calls.length;
    const result = await callRaw('sleeper_get_matchups', { league_id: '999', week: 99 });
    expect(result.isError).toBe(true);
    expect(calls.length).toBe(before);
  });

  it('resolves trending players to names and keeps unknown IDs', async () => {
    const trending = await callJson('sleeper_get_trending_players', { type: 'add', limit: 2 });
    expect(trending[0]).toMatchObject({ name: 'Justin Jefferson', position: 'WR', adds: 5000 });
    expect(trending[1].name).toBe('unknown-id');
  });

  it('searches players', async () => {
    const found = await callJson('sleeper_search_players', { query: 'jeff' });
    expect(found.players[0].name).toBe('Justin Jefferson');
  });

  it('looks up players by ID', async () => {
    const players = await callJson('sleeper_lookup_players', { player_ids: ['4034', 'DET'] });
    expect(players.map((p: any) => p.name)).toEqual(['Alvin Kamara', 'Detroit Lions']);
  });

  it('uses the losers_bracket path, not the docs typo', async () => {
    await callJson('sleeper_get_playoff_bracket', { league_id: '999', bracket: 'losers' });
    expect(calls).toContain('/league/999/losers_bracket');
  });
});

describe('derived tools', () => {
  it('finds leagues from a username in one call', async () => {
    const found = await callJson('sleeper_find_leagues', { username: 'alice' });
    expect(found.user.user_id).toBe('u1');
    expect(found.season).toBe('2025'); // defaulted from league_season
    expect(found.leagues[0]).toMatchObject({ league_id: '999', name: 'Test Dynasty', scoring_format: 'PPR' });
  });

  it('builds standings sorted by record then points', async () => {
    const standings = await callJson('sleeper_get_standings', { league_id: '999' });
    expect(standings.standings.map((r: any) => r.team)).toEqual(['Kamara Sutra', 'Bob']);
    expect(standings.standings[0]).toMatchObject({
      rank: 1,
      record: '1-0',
      points_for: 120.5,
      points_against: 98.2,
      faab_remaining: 85, // 100 budget - 15 used
    });
  });

  it('resolves a roster by team nickname, splitting starters and bench', async () => {
    const roster = await callJson('sleeper_get_roster', { league_id: '999', team: 'Kamara Sutra' });
    expect(roster.roster_id).toBe(1);
    // Starter slots come from the league's roster_positions, minus bench slots.
    expect(roster.starters.map((s: any) => s.slot)).toEqual(['QB', 'RB', 'WR', 'DEF']);
    expect(roster.starters[0].name).toBe('Lamar Jackson');
    expect(roster.starters[2].injury_status).toBe('Questionable');
    expect(roster.bench.map((b: any) => b.name)).toEqual(['Retired Guy']);
  });

  it('resolves a roster by username, display name and roster_id alike', async () => {
    for (const team of ['alice', 'Alice', '1']) {
      expect((await callJson('sleeper_get_roster', { league_id: '999', team })).roster_id).toBe(1);
    }
    expect((await callJson('sleeper_get_roster', { league_id: '999', team: 'bob' })).roster_id).toBe(2);
  });

  it('lists the available teams when no team matches', async () => {
    const result = await callRaw('sleeper_get_roster', { league_id: '999', team: 'nobody' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Kamara Sutra');
  });

  it('pairs matchups, resolves both lineups and computes the margin', async () => {
    const report = await callJson('sleeper_get_matchup_report', { league_id: '999', week: 1 });
    expect(report.matchups).toHaveLength(1);
    const [game] = report.matchups;
    expect(game.margin).toBe(22.3);
    expect(game.leader).toBe('Kamara Sutra');
    expect(game.teams[0].starters[0]).toBe('QB: Lamar Jackson (BAL) - 25.4');
    // "0" is an empty slot, not a player.
    expect(game.teams[1].starters[0]).toBe('QB: 0 - 0');
  });

  it('defaults the matchup week to the current NFL week', async () => {
    const report = await callJson('sleeper_get_matchup_report', { league_id: '999' });
    expect(report.week).toBe(1);
  });

  it('reports an empty week without failing', async () => {
    const report = await callJson('sleeper_get_matchup_report', { league_id: '999', week: 2 });
    expect(report.matchups).toEqual([]);
    expect(report.note).toContain('No matchups');
  });

  it('includes bench only when asked', async () => {
    const withoutBench = await callJson('sleeper_get_matchup_report', { league_id: '999', week: 1 });
    expect(withoutBench.matchups[0].teams[0]).not.toHaveProperty('bench');
    const withBench = await callJson('sleeper_get_matchup_report', {
      league_id: '999',
      week: 1,
      include_bench: true,
    });
    expect(withBench.matchups[0].teams[0].bench).toEqual(['Retired Guy (WR)']);
  });

  it('resolves names, FAAB and picks in the transaction feed', async () => {
    const feed = await callJson('sleeper_get_transaction_feed', { league_id: '999', week: 1 });
    // Defaults to complete-only, so the failed waiver is excluded.
    expect(feed.count).toBe(2);

    const waiver = feed.transactions.find((t: any) => t.type === 'waiver');
    expect(waiver.adds).toEqual(['Justin Jefferson (WR, MIN) [Questionable] -> Kamara Sutra']);
    expect(waiver.drops).toEqual(['Retired Guy (WR) -> Kamara Sutra']);
    expect(waiver.waiver_bid).toBe(15);

    const trade = feed.transactions.find((t: any) => t.type === 'trade');
    expect(trade.picks).toEqual(['2026 round 1 (Bob) -> Kamara Sutra']);
    expect(trade.faab).toEqual(['$25: Kamara Sutra -> Bob']);
  });

  it('can include failed transactions', async () => {
    const feed = await callJson('sleeper_get_transaction_feed', { league_id: '999', week: 1, status: 'all' });
    expect(feed.count).toBe(3);
  });

  it('lays out a draft board by round with keeper flags', async () => {
    const board = await callJson('sleeper_get_draft_board', { draft_id: '777' });
    expect(board.board.map((r: any) => r.round)).toEqual([1, 2]);
    expect(board.board[0].picks[0]).toMatchObject({
      pick_no: 1,
      team: 'Kamara Sutra',
      player: 'Justin Jefferson (WR, MIN) [Questionable]',
    });
    expect(board.board[0].picks[1].keeper).toBe(true);
    expect(board.board[1].picks[0].keeper).toBeUndefined();
  });

  it('filters the draft board to one round', async () => {
    const board = await callJson('sleeper_get_draft_board', { draft_id: '777', round: 2 });
    expect(board.total_picks).toBe(1);
    expect(board.board).toHaveLength(1);
  });

  it('still renders a draft board when the league is gone', async () => {
    await client.close();
    await connect({ notFound: ['/league/999'] });
    const board = await callJson('sleeper_get_draft_board', { draft_id: '777' });
    expect(board.board[0].picks[0].team).toBe('Roster 1');
  });
});

describe('dynasty rosters (taxi squad + IR)', () => {
  it('excludes taxi and IR players from the bench', async () => {
    // Roster 1 holds 5 players: 2 starting, 1 bench, 1 taxi, 1 IR.
    // "players minus starters" would wrongly report 3 on the bench.
    const roster = await callJson('sleeper_get_roster', { league_id: '888', team: 'dynastyowner' });
    expect(roster.bench.map((b: any) => b.name)).toEqual(['Justin Jefferson']);
    expect(roster.taxi).toEqual(['Retired Guy (WR)']);
    expect(roster.reserve).toEqual(['Detroit Lions (DEF, DET)']);
  });

  it('reports counts that add up to the roster size', async () => {
    const roster = await callJson('sleeper_get_roster', { league_id: '888', team: 'dynastyowner' });
    expect(roster.counts).toEqual({ starters: 2, bench: 1, taxi: 1, reserve: 1 });
    const { starters, bench, taxi, reserve } = roster.counts;
    expect(bench + taxi + reserve + starters).toBe(5);
  });

  it('keeps taxi and IR out of the matchup bench too', async () => {
    // The matchup payload carries taxi/IR players but no taxi/reserve fields,
    // so the bench there has to be derived against the roster.
    const report = await callJson('sleeper_get_matchup_report', {
      league_id: '888',
      week: 1,
      include_bench: true,
    });
    expect(report.matchups[0].teams[0].bench).toEqual(['Justin Jefferson (WR, MIN) [Questionable]']);
  });

  it('still handles a roster with no taxi or IR at all', async () => {
    const roster = await callJson('sleeper_get_roster', { league_id: '888', team: 'rival' });
    expect(roster.counts).toEqual({ starters: 2, bench: 0, taxi: 0, reserve: 0 });
    expect(roster.starters[1].empty).toBe(true);
  });
});

describe('caching', () => {
  it('reuses league data across derived tools instead of refetching', async () => {
    await callJson('sleeper_get_standings', { league_id: '999' });
    const afterFirst = calls.filter((c) => c === '/league/999/rosters').length;
    await callJson('sleeper_get_roster', { league_id: '999', team: 'alice' });
    await callJson('sleeper_get_matchup_report', { league_id: '999', week: 1 });
    expect(calls.filter((c) => c === '/league/999/rosters').length).toBe(afterFirst);
  });

  it('downloads the player map at most once', async () => {
    await callJson('sleeper_search_players', { query: 'kamara' });
    await callJson('sleeper_lookup_players', { player_ids: ['4034'] });
    await callJson('sleeper_get_roster', { league_id: '999', team: 'alice' });
    expect(calls.filter((c) => c === '/players/nfl')).toHaveLength(1);
  });

  it('does not fetch the player map until a tool needs names', async () => {
    await callJson('sleeper_get_nfl_state', {});
    await callJson('sleeper_get_standings', { league_id: '999' });
    expect(calls).not.toContain('/players/nfl');
  });

  it('reports snapshot freshness', async () => {
    const status = await callJson('sleeper_get_player_data_status', {});
    expect(status.count).toBe(5);
    expect(status.stale).toBe(false);
    expect(status.fetched_at).toMatch(/^\d{4}-/);
  });

  it('re-downloads only when explicitly refreshed', async () => {
    await callJson('sleeper_search_players', { query: 'kamara' });
    expect(calls.filter((c) => c === '/players/nfl')).toHaveLength(1);

    const refreshed = await callJson('sleeper_refresh_players', {});
    expect(refreshed.refreshed).toBe(true);
    expect(refreshed.count).toBe(5);
    expect(calls.filter((c) => c === '/players/nfl')).toHaveLength(2);
  });
});
