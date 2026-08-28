import { DiskCache, TTL } from './cache.js';
import type { SleeperClient } from './client.js';

/** The raw /players response is a map of player_id -> a ~40-field object. */
interface RawPlayer {
  player_id?: string;
  first_name?: string | null;
  last_name?: string | null;
  full_name?: string | null;
  position?: string | null;
  fantasy_positions?: string[] | null;
  team?: string | null;
  status?: string | null;
  injury_status?: string | null;
  number?: number | string | null;
  age?: number | null;
  years_exp?: number | null;
  search_full_name?: string | null;
  search_rank?: number | null;
  depth_chart_order?: number | null;
  active?: boolean | null;
}

/**
 * The projection we keep. The full map is ~15MB on the wire and far larger once
 * parsed; holding only these fields keeps the resident index small enough to sit
 * in memory for the life of the process.
 */
export interface Player {
  player_id: string;
  name: string;
  position: string | null;
  team: string | null;
  status: string | null;
  injury_status: string | null;
  number: number | null;
  age: number | null;
  years_exp: number | null;
  fantasy_positions: string[];
  search_rank: number | null;
  depth_chart_order: number | null;
  active: boolean;
  search_name: string;
}

const normalize = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');

function project(id: string, raw: RawPlayer): Player {
  const first = raw.first_name?.trim() ?? '';
  const last = raw.last_name?.trim() ?? '';
  const name = raw.full_name?.trim() || [first, last].filter(Boolean).join(' ') || id;
  const num = typeof raw.number === 'string' ? Number.parseInt(raw.number, 10) : raw.number;
  return {
    player_id: raw.player_id ?? id,
    name,
    position: raw.position ?? null,
    team: raw.team ?? null,
    status: raw.status ?? null,
    injury_status: raw.injury_status || null,
    number: Number.isFinite(num) ? (num as number) : null,
    age: raw.age ?? null,
    years_exp: raw.years_exp ?? null,
    fantasy_positions: raw.fantasy_positions ?? [],
    search_rank: raw.search_rank ?? null,
    depth_chart_order: raw.depth_chart_order ?? null,
    active: raw.active ?? raw.status === 'Active',
    search_name: raw.search_full_name?.trim() || normalize(name),
  };
}

export interface SearchOptions {
  query?: string;
  position?: string;
  team?: string;
  active?: boolean;
  limit?: number;
}

export interface PlayerIndexStatus {
  /** Players currently indexed. */
  count: number;
  /** When the map was last pulled from Sleeper, or null if never. */
  fetched_at: string | null;
  age_hours: number | null;
  /** True once the snapshot is older than a day. */
  stale: boolean;
  /** Present only when stale — tells the model what it can no longer trust. */
  note?: string;
}

/**
 * Owns the player map: fetch, slim, persist, index, look up.
 *
 * Fetch-once semantics. The full map is ~15MB on the wire and Sleeper asks that
 * it be pulled at most once a day, so the snapshot is written to disk and then
 * kept indefinitely — restarts reuse it, and it is only re-downloaded when
 * something explicitly asks (the sleeper_refresh_players tool).
 *
 * The tradeoff is that volatile fields go stale. Identity (id, name, position)
 * is effectively permanent, but `injury_status`, `team`, `status` and
 * `depth_chart_order` change daily, so `status()` reports the snapshot's age and
 * every tool that surfaces those fields passes the warning along.
 *
 * Set SLEEPER_MCP_PLAYER_MAX_AGE_HOURS to opt into automatic refresh instead.
 */
export class PlayerIndex {
  private players = new Map<string, Player>();
  private loading: Promise<void> | null = null;
  private fetchedAt: number | null = null;
  private readonly maxAgeMs: number;

  constructor(
    private readonly client: SleeperClient,
    private readonly sport = 'nfl',
    private readonly disk = new DiskCache(),
    maxAgeMs?: number,
  ) {
    const configured = Number(process.env.SLEEPER_MCP_PLAYER_MAX_AGE_HOURS);
    this.maxAgeMs =
      maxAgeMs ?? (Number.isFinite(configured) && configured > 0 ? configured * 3_600_000 : Number.POSITIVE_INFINITY);
  }

  get size(): number {
    return this.players.size;
  }

  get isLoaded(): boolean {
    if (this.players.size === 0 || this.fetchedAt === null) return false;
    return Date.now() - this.fetchedAt < this.maxAgeMs;
  }

  /** Age of the snapshot and whether its volatile fields should be trusted. */
  status(): PlayerIndexStatus {
    if (this.fetchedAt === null) {
      return { count: this.players.size, fetched_at: null, age_hours: null, stale: false };
    }
    const ageHours = (Date.now() - this.fetchedAt) / 3_600_000;
    const stale = ageHours > TTL.playerMapStaleAfter / 3_600_000;
    return {
      count: this.players.size,
      fetched_at: new Date(this.fetchedAt).toISOString(),
      age_hours: Math.round(ageHours * 10) / 10,
      stale,
      ...(stale
        ? {
            note: `Player snapshot is ${Math.floor(ageHours / 24)} day(s) old. Names and positions are still accurate, but injury_status, team and status may be out of date. Call sleeper_refresh_players to update.`,
          }
        : {}),
    };
  }

  async ensureLoaded(): Promise<void> {
    if (this.isLoaded) return;
    // Collapse concurrent first-calls onto one download.
    this.loading ??= this.load().finally(() => {
      this.loading = null;
    });
    return this.loading;
  }

  private async load(force = false): Promise<void> {
    const cacheKey = `players-${this.sport}`;
    if (!force) {
      const cached = await this.disk.readWithMeta<Player[]>(cacheKey, this.maxAgeMs);
      if (cached?.value?.length) {
        this.hydrate(cached.value, cached.savedAt);
        return;
      }
    }

    const raw = await this.client.get<Record<string, RawPlayer>>(`/players/${this.sport}`);
    const slim = Object.entries(raw).map(([id, value]) => project(id, value));
    this.hydrate(slim, Date.now());
    await this.disk.write(cacheKey, slim);
  }

  private hydrate(list: Player[], fetchedAt: number): void {
    this.players = new Map(list.map((p) => [p.player_id, p]));
    this.fetchedAt = fetchedAt;
  }

  /** Re-downloads the map from Sleeper, ignoring the cached snapshot. */
  async refresh(): Promise<PlayerIndexStatus> {
    this.loading = this.load(true).finally(() => {
      this.loading = null;
    });
    await this.loading;
    return this.status();
  }

  get(playerId: string): Player | undefined {
    return this.players.get(playerId);
  }

  /** Resolves a list of IDs, preserving order. Unknown IDs become a stub. */
  resolve(ids: readonly string[]): Player[] {
    return ids.map(
      (id) =>
        this.players.get(id) ?? {
          player_id: id,
          name: id,
          position: null,
          team: null,
          status: null,
          injury_status: null,
          number: null,
          age: null,
          years_exp: null,
          fantasy_positions: [],
          search_rank: null,
          depth_chart_order: null,
          active: false,
          search_name: normalize(id),
        },
    );
  }

  search(opts: SearchOptions): Player[] {
    const limit = opts.limit ?? 25;
    const q = opts.query ? normalize(opts.query) : undefined;
    const position = opts.position?.toUpperCase();
    const team = opts.team?.toUpperCase();

    const matches: Player[] = [];
    for (const player of this.players.values()) {
      if (opts.active === true && !player.active) continue;
      if (opts.active === false && player.active) continue;
      if (position && player.position !== position && !player.fantasy_positions.includes(position)) continue;
      if (team && player.team !== team) continue;
      if (q && !player.search_name.includes(q)) continue;
      matches.push(player);
    }

    // search_rank is Sleeper's own relevance ordering (lower = more relevant);
    // players without one are typically inactive, so they sort last.
    matches.sort((a, b) => {
      if (q) {
        const aExact = a.search_name === q ? 0 : a.search_name.startsWith(q) ? 1 : 2;
        const bExact = b.search_name === q ? 0 : b.search_name.startsWith(q) ? 1 : 2;
        if (aExact !== bExact) return aExact - bExact;
      }
      const ar = a.search_rank ?? Number.MAX_SAFE_INTEGER;
      const br = b.search_rank ?? Number.MAX_SAFE_INTEGER;
      if (ar !== br) return ar - br;
      return a.name.localeCompare(b.name);
    });

    return matches.slice(0, limit);
  }
}
