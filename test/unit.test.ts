import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DiskCache, TtlCache } from '../src/cache.js';
import { SleeperClient } from '../src/client.js';
import { combinePoints, playerLine, record, scoringFormat, summarizeLeague, teamName } from '../src/format.js';
import { PlayerIndex } from '../src/players.js';
import { RateLimiter } from '../src/ratelimit.js';
import type { League, Roster } from '../src/types.js';
import { LEAGUE, ROSTERS, USERS, makeFetchStub } from './fixtures.js';

describe('TtlCache', () => {
  it('serves a hit and expires on TTL', async () => {
    const cache = new TtlCache();
    let calls = 0;
    const load = async () => ++calls;

    expect(await cache.wrap('k', 50, load)).toBe(1);
    expect(await cache.wrap('k', 50, load)).toBe(1);
    expect(calls).toBe(1);

    await new Promise((r) => setTimeout(r, 60));
    expect(await cache.wrap('k', 50, load)).toBe(2);
  });
});

describe('DiskCache', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sleeper-mcp-test-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('round-trips a value', async () => {
    const disk = new DiskCache(dir);
    await disk.write('thing', [1, 2, 3]);
    expect(await disk.read('thing', 60_000)).toEqual([1, 2, 3]);
  });

  it('treats a stale entry as a miss', async () => {
    const disk = new DiskCache(dir);
    await disk.write('thing', [1]);
    expect(await disk.read('thing', -1)).toBeUndefined();
  });

  it('returns undefined for a missing file rather than throwing', async () => {
    expect(await new DiskCache(dir).read('nope', 60_000)).toBeUndefined();
  });
});

describe('RateLimiter', () => {
  it('lets a burst through up to capacity, then throttles', async () => {
    const limiter = new RateLimiter(60); // 1/sec
    const start = Date.now();
    for (let i = 0; i < 60; i++) await limiter.acquire();
    expect(Date.now() - start).toBeLessThan(200);

    await limiter.acquire(); // 61st must wait for a refill
    expect(Date.now() - start).toBeGreaterThanOrEqual(500);
  });
});

describe('format helpers', () => {
  it('recombines split point fields', () => {
    expect(combinePoints(120, 5)).toBe(120.5);
    expect(combinePoints(98, 0)).toBe(98);
    expect(combinePoints(undefined, undefined)).toBe(0);
  });

  it('reads scoring format off the reception value', () => {
    expect(scoringFormat(LEAGUE as League)).toBe('PPR');
    expect(scoringFormat({ ...LEAGUE, scoring_settings: { rec: 0.5 } } as unknown as League)).toBe('0.5 PPR');
    expect(scoringFormat({ ...LEAGUE, scoring_settings: { rec: 0 } } as unknown as League)).toBe('standard');
    expect(scoringFormat({ ...LEAGUE, scoring_settings: {} } as unknown as League)).toBe('unknown');
  });

  it('prefers a team nickname, then display name', () => {
    expect(teamName(USERS[0] as never, ROSTERS[0] as unknown as Roster)).toBe('Kamara Sutra');
    expect(teamName(USERS[1] as never, ROSTERS[1] as unknown as Roster)).toBe('Bob');
    expect(teamName(undefined, ROSTERS[1] as unknown as Roster)).toBe('Roster 2');
  });

  it('renders a record, hiding zero ties', () => {
    expect(record(ROSTERS[0] as unknown as Roster)).toBe('1-0');
    expect(record({ settings: { wins: 3, losses: 2, ties: 1 } } as unknown as Roster)).toBe('3-2-1');
  });

  it('trims league settings unless verbose', () => {
    const trimmed = summarizeLeague(LEAGUE as League) as Record<string, Record<string, unknown>>;
    expect(trimmed.scoring_settings).toHaveProperty('rec');
    // blk_kick is real but noise for a model reading a league summary.
    expect(trimmed.scoring_settings).not.toHaveProperty('blk_kick');
    expect(summarizeLeague(LEAGUE as League, true)).toBe(LEAGUE);
  });
});

describe('PlayerIndex', () => {
  const buildIndex = async (dir: string) => {
    const { fetch, calls } = makeFetchStub();
    const index = new PlayerIndex(new SleeperClient({ fetchImpl: fetch }), 'nfl', new DiskCache(dir));
    await index.ensureLoaded();
    return { index, calls };
  };

  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sleeper-players-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('loads and projects the player map', async () => {
    const { index } = await buildIndex(dir);
    expect(index.size).toBe(5);
    const kamara = index.get('4034');
    expect(kamara?.name).toBe('Alvin Kamara');
    expect(kamara?.position).toBe('RB');
  });

  it('downloads once even under concurrent first calls', async () => {
    const { fetch, calls } = makeFetchStub();
    const index = new PlayerIndex(new SleeperClient({ fetchImpl: fetch }), 'nfl', new DiskCache(dir));
    await Promise.all([index.ensureLoaded(), index.ensureLoaded(), index.ensureLoaded()]);
    expect(calls.filter((c) => c === '/players/nfl')).toHaveLength(1);
  });

  it('serves a second index from disk without refetching', async () => {
    await buildIndex(dir);
    const { calls } = await buildIndex(dir);
    expect(calls).not.toContain('/players/nfl');
  });

  it('keeps using an old snapshot rather than re-downloading', async () => {
    // Fetch-once semantics: age alone must never trigger a 15MB download.
    await buildIndex(dir);
    const stalePath = join(dir, 'players-nfl.json');
    const raw = JSON.parse(await readFile(stalePath, 'utf8'));
    raw.savedAt = Date.now() - 30 * 24 * 3600 * 1000; // 30 days old
    await writeFile(stalePath, JSON.stringify(raw), 'utf8');

    const { index, calls } = await buildIndex(dir);
    expect(calls).not.toContain('/players/nfl');
    expect(index.size).toBe(5);

    const status = index.status();
    expect(status.stale).toBe(true);
    expect(status.age_hours).toBeGreaterThan(700);
    expect(status.note).toContain('sleeper_refresh_players');
  });

  it('re-downloads on an explicit refresh', async () => {
    const { fetch, calls } = makeFetchStub();
    const index = new PlayerIndex(new SleeperClient({ fetchImpl: fetch }), 'nfl', new DiskCache(dir));
    await index.ensureLoaded();
    expect(calls.filter((c) => c === '/players/nfl')).toHaveLength(1);

    const status = await index.refresh();
    expect(calls.filter((c) => c === '/players/nfl')).toHaveLength(2);
    expect(status.count).toBe(5);
    expect(status.stale).toBe(false);
  });

  it('honours an explicit max age when one is configured', async () => {
    const { fetch, calls } = makeFetchStub();
    const build = () => new PlayerIndex(new SleeperClient({ fetchImpl: fetch }), 'nfl', new DiskCache(dir), -1);
    await build().ensureLoaded();
    await build().ensureLoaded();
    expect(calls.filter((c) => c === '/players/nfl')).toHaveLength(2);
  });

  it('resolves IDs in order and stubs unknown ones', async () => {
    const { index } = await buildIndex(dir);
    const resolved = index.resolve(['6794', 'DET', 'not-a-player']);
    expect(resolved.map((p) => p.name)).toEqual(['Justin Jefferson', 'Detroit Lions', 'not-a-player']);
  });

  it('searches by name, ranking exact matches first', async () => {
    const { index } = await buildIndex(dir);
    expect(index.search({ query: 'kamara' })[0]?.name).toBe('Alvin Kamara');
    expect(index.search({ query: 'Alvin Kamara' })[0]?.player_id).toBe('4034');
  });

  it('filters by position, team and active status', async () => {
    const { index } = await buildIndex(dir);
    expect(index.search({ position: 'WR' }).map((p) => p.player_id).sort()).toEqual(['1234', '6794']);
    expect(index.search({ position: 'WR', active: true }).map((p) => p.player_id)).toEqual(['6794']);
    expect(index.search({ team: 'BAL' }).map((p) => p.player_id)).toEqual(['4881']);
  });

  it('honours the limit', async () => {
    const { index } = await buildIndex(dir);
    expect(index.search({ limit: 2 })).toHaveLength(2);
  });

  it('renders a compact player line', async () => {
    const { index } = await buildIndex(dir);
    expect(playerLine(index.get('6794')!)).toBe('Justin Jefferson (WR, MIN) [Questionable]');
    expect(playerLine(index.get('4034')!)).toBe('Alvin Kamara (RB, NO)');
  });
});
