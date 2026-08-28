import { TtlCache, TTL } from './cache.js';
import { SleeperClient, type ClientOptions } from './client.js';
import { PlayerIndex } from './players.js';
import type {
  BracketMatch,
  Draft,
  DraftPick,
  DraftPickAsset,
  League,
  Matchup,
  Roster,
  SleeperUser,
  SportState,
  Transaction,
  TrendingPlayer,
} from './types.js';

/**
 * Cached, typed access to every documented Sleeper endpoint.
 *
 * Tools go through here rather than the raw client so that a derived tool making
 * four endpoint calls (rosters + users + matchups + state) does not re-fetch
 * data another tool pulled seconds earlier.
 */
export class SleeperApi {
  readonly client: SleeperClient;
  readonly players: PlayerIndex;
  private readonly cache = new TtlCache();

  constructor(opts: ClientOptions = {}) {
    this.client = new SleeperClient(opts);
    this.players = new PlayerIndex(this.client);
  }

  // --- Users -------------------------------------------------------------

  /** Accepts either a username or a numeric user_id. */
  getUser(usernameOrId: string): Promise<SleeperUser> {
    return this.cache.wrap(`user:${usernameOrId}`, TTL.league, () =>
      this.client.get<SleeperUser>(`/user/${encodeURIComponent(usernameOrId)}`),
    );
  }

  getUserLeagues(userId: string, season: string, sport = 'nfl'): Promise<League[]> {
    return this.cache.wrap(`user-leagues:${userId}:${sport}:${season}`, TTL.league, () =>
      this.client.get<League[]>(`/user/${encodeURIComponent(userId)}/leagues/${sport}/${season}`),
    );
  }

  getUserDrafts(userId: string, season: string, sport = 'nfl'): Promise<Draft[]> {
    return this.cache.wrap(`user-drafts:${userId}:${sport}:${season}`, TTL.drafts, () =>
      this.client.get<Draft[]>(`/user/${encodeURIComponent(userId)}/drafts/${sport}/${season}`),
    );
  }

  // --- Leagues -----------------------------------------------------------

  getLeague(leagueId: string): Promise<League> {
    return this.cache.wrap(`league:${leagueId}`, TTL.league, () =>
      this.client.get<League>(`/league/${encodeURIComponent(leagueId)}`),
    );
  }

  getRosters(leagueId: string): Promise<Roster[]> {
    return this.cache.wrap(`rosters:${leagueId}`, TTL.rosters, () =>
      this.client.get<Roster[]>(`/league/${encodeURIComponent(leagueId)}/rosters`),
    );
  }

  getLeagueUsers(leagueId: string): Promise<SleeperUser[]> {
    return this.cache.wrap(`league-users:${leagueId}`, TTL.users, () =>
      this.client.get<SleeperUser[]>(`/league/${encodeURIComponent(leagueId)}/users`),
    );
  }

  getMatchups(leagueId: string, week: number): Promise<Matchup[]> {
    return this.cache.wrap(`matchups:${leagueId}:${week}`, TTL.matchups, () =>
      this.client.get<Matchup[]>(`/league/${encodeURIComponent(leagueId)}/matchups/${week}`),
    );
  }

  /**
   * Playoff bracket. Note the docs' HTTP Request line says `loses_bracket`;
   * the path that actually works is `losers_bracket`.
   */
  getBracket(leagueId: string, type: 'winners' | 'losers'): Promise<BracketMatch[]> {
    return this.cache.wrap(`bracket:${leagueId}:${type}`, TTL.league, () =>
      this.client.get<BracketMatch[]>(`/league/${encodeURIComponent(leagueId)}/${type}_bracket`),
    );
  }

  getTransactions(leagueId: string, round: number): Promise<Transaction[]> {
    return this.cache.wrap(`transactions:${leagueId}:${round}`, TTL.transactions, () =>
      this.client.get<Transaction[]>(`/league/${encodeURIComponent(leagueId)}/transactions/${round}`),
    );
  }

  getTradedPicks(leagueId: string): Promise<DraftPickAsset[]> {
    return this.cache.wrap(`traded-picks:${leagueId}`, TTL.league, () =>
      this.client.get<DraftPickAsset[]>(`/league/${encodeURIComponent(leagueId)}/traded_picks`),
    );
  }

  getLeagueDrafts(leagueId: string): Promise<Draft[]> {
    return this.cache.wrap(`league-drafts:${leagueId}`, TTL.drafts, () =>
      this.client.get<Draft[]>(`/league/${encodeURIComponent(leagueId)}/drafts`),
    );
  }

  // --- State -------------------------------------------------------------

  getState(sport = 'nfl'): Promise<SportState> {
    return this.cache.wrap(`state:${sport}`, TTL.state, () => this.client.get<SportState>(`/state/${sport}`));
  }

  /** The week most tools should default to when the caller does not name one. */
  async currentWeek(sport = 'nfl'): Promise<number> {
    const state = await this.getState(sport);
    // `leg` is 0 during the preseason, so fall back through display_week/week.
    return state.leg || state.display_week || state.week || 1;
  }

  // --- Drafts ------------------------------------------------------------

  async getDraft(draftId: string): Promise<Draft> {
    const key = `draft:${draftId}`;
    const cached = this.cache.get<Draft>(key);
    if (cached) return cached;
    const draft = await this.client.get<Draft>(`/draft/${encodeURIComponent(draftId)}`);
    // A finished draft never changes again; hold it far longer.
    this.cache.set(key, draft, draft.status === 'complete' ? TTL.completedDraft : TTL.drafts);
    return draft;
  }

  getDraftPicks(draftId: string): Promise<DraftPick[]> {
    return this.cache.wrap(`draft-picks:${draftId}`, TTL.drafts, () =>
      this.client.get<DraftPick[]>(`/draft/${encodeURIComponent(draftId)}/picks`),
    );
  }

  getDraftTradedPicks(draftId: string): Promise<DraftPickAsset[]> {
    return this.cache.wrap(`draft-traded-picks:${draftId}`, TTL.drafts, () =>
      this.client.get<DraftPickAsset[]>(`/draft/${encodeURIComponent(draftId)}/traded_picks`),
    );
  }

  // --- Players -----------------------------------------------------------

  getTrending(
    type: 'add' | 'drop',
    opts: { sport?: string; lookbackHours?: number; limit?: number } = {},
  ): Promise<TrendingPlayer[]> {
    const sport = opts.sport ?? 'nfl';
    const lookback = opts.lookbackHours ?? 24;
    const limit = opts.limit ?? 25;
    return this.cache.wrap(`trending:${sport}:${type}:${lookback}:${limit}`, TTL.trending, () =>
      this.client.get<TrendingPlayer[]>(`/players/${sport}/trending/${type}`, {
        lookback_hours: lookback,
        limit,
      }),
    );
  }
}
