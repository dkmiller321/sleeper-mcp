import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SleeperApi } from '../src/api.js';
import { DiskCache } from '../src/cache.js';
import { createServer } from '../src/index.js';
import { PlayerIndex } from '../src/players.js';

/**
 * Smoke tests against the real Sleeper API. Opt in with SLEEPER_MCP_LIVE=1.
 *
 * These assert on structure and invariants, never on specific players or scores,
 * so they stay green as the season moves. Set SLEEPER_MCP_TEST_USER to a real
 * Sleeper username to also exercise the league-scoped tools.
 */
const live = process.env.SLEEPER_MCP_LIVE === '1';
const testUser = process.env.SLEEPER_MCP_TEST_USER;

describe.skipIf(!live)('live Sleeper API', () => {
  let client: Client;
  let cacheDir: string;

  beforeAll(async () => {
    cacheDir = await mkdtemp(join(tmpdir(), 'sleeper-live-'));
    const api = new SleeperApi();
    Object.assign(api, { players: new PlayerIndex(api.client, 'nfl', new DiskCache(cacheDir)) });
    const server = createServer(api);
    const [c, s] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'live-test', version: '0' });
    await Promise.all([client.connect(c), server.connect(s)]);
  }, 120_000);

  afterAll(async () => {
    await client?.close();
    if (cacheDir) await rm(cacheDir, { recursive: true, force: true });
  });

  const callJson = async (name: string, args: Record<string, unknown> = {}): Promise<any> => {
    const result = (await client.callTool({ name, arguments: args })) as {
      content: { text: string }[];
      isError?: boolean;
    };
    expect(result.isError, `${name}: ${result.content[0]?.text}`).toBeFalsy();
    return JSON.parse(result.content[0].text);
  };

  it('reads NFL state', async () => {
    const state = await callJson('sleeper_get_nfl_state', {});
    expect(state.season).toMatch(/^\d{4}$/);
    expect(['pre', 'regular', 'post', 'off']).toContain(state.season_type);
    expect(typeof state.week).toBe('number');
  });

  it('loads the real player map and finds a well-known player', async () => {
    const found = await callJson('sleeper_search_players', { query: 'mahomes', limit: 5 });
    expect(found.count).toBeGreaterThan(0);
    expect(found.players[0].name.toLowerCase()).toContain('mahomes');
    expect(found.players[0].position).toBe('QB');
  }, 120_000);

  it('filters the player map by position and team', async () => {
    const kcQbs = await callJson('sleeper_search_players', { position: 'QB', team: 'KC', limit: 10 });
    expect(kcQbs.count).toBeGreaterThan(0);
    for (const p of kcQbs.players) {
      expect(p.team).toBe('KC');
      expect(p.position).toBe('QB');
    }
  }, 120_000);

  it('resolves team defenses, which use a team code as the player_id', async () => {
    const [def] = await callJson('sleeper_lookup_players', { player_ids: ['DET'] });
    expect(def.position).toBe('DEF');
    expect(def.name.toLowerCase()).toContain('lions');
  }, 120_000);

  it('returns trending adds with resolved names', async () => {
    const trending = await callJson('sleeper_get_trending_players', { type: 'add', limit: 5 });
    expect(trending.length).toBeGreaterThan(0);
    expect(trending[0]).toHaveProperty('adds');
    // Every trending ID should resolve to a real name, not fall back to the ID.
    expect(trending[0].name).not.toBe(trending[0].player_id);
  }, 120_000);

  it('reports a bad username as not found (HTTP 200 + null body)', async () => {
    const result = (await client.callTool({
      name: 'sleeper_get_user',
      arguments: { username_or_id: 'zzz-not-a-real-sleeper-user-9182' },
    })) as { content: { text: string }[]; isError?: boolean };
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('no data');
  });

  it('reports a bad league as not found (HTTP 404)', async () => {
    const result = (await client.callTool({
      name: 'sleeper_get_league',
      arguments: { league_id: '000000000000000000' },
    })) as { content: { text: string }[]; isError?: boolean };
    expect(result.isError).toBe(true);
  });

  describe.skipIf(!testUser)('league flow', () => {
    let leagueId: string | undefined;

    /**
     * Fails rather than returning early. An earlier version of these tests
     * bailed with `if (!leagueId) return`, which reported a green pass for a
     * league flow that had never run - a worse outcome than a red failure.
     */
    const requireLeague = (): string => {
      if (!leagueId) {
        throw new Error(
          `No league resolved for user "${testUser}". Either the username is wrong or the account has no leagues this season; these tests cannot verify anything without one.`,
        );
      }
      return leagueId;
    };

    it('finds leagues for the configured user', async () => {
      const found = await callJson('sleeper_find_leagues', { username: testUser! });
      expect(found.user.user_id).toMatch(/^\d+$/);
      expect(
        found.leagues.length,
        `User "${testUser}" exists but has no ${found.season} leagues.`,
      ).toBeGreaterThan(0);
      leagueId = found.leagues[0].league_id;
    });

    it('builds standings', async () => {
      const standings = await callJson('sleeper_get_standings', { league_id: requireLeague() });
      expect(standings.standings.length).toBeGreaterThan(0);
      expect(standings.standings[0].rank).toBe(1);
      // Every team must resolve to a name, never a bare roster id.
      for (const row of standings.standings) expect(row.team).not.toMatch(/^Roster \d+$/);
    }, 120_000);

    it('renders a roster with named players', async () => {
      const id = requireLeague();
      const standings = await callJson('sleeper_get_standings', { league_id: id });
      const roster = await callJson('sleeper_get_roster', {
        league_id: id,
        team: String(standings.standings[0].roster_id),
      });
      expect(roster.starters.length).toBeGreaterThan(0);
      for (const s of roster.starters) {
        if (s.empty) continue;
        expect(s.name).not.toBe(s.player_id); // resolved, not a raw ID
      }
    }, 120_000);

    it('renders a matchup report', async () => {
      const report = await callJson('sleeper_get_matchup_report', { league_id: requireLeague(), week: 1 });
      expect(report).toHaveProperty('week', 1);
      for (const game of report.matchups) {
        expect(game.teams.length).toBeLessThanOrEqual(2);
      }
    }, 120_000);
  });
});
