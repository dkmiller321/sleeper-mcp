/**
 * A tiny but realistic Sleeper league, plus a fetch stub that serves it.
 *
 * Shapes here mirror the real API exactly, including the parts that trip people
 * up: split fpts/fpts_decimal point fields, "0" as an empty starter slot, string
 * roster_id on draft picks, and team defenses whose player_id is a team code.
 */

export const PLAYERS: Record<string, unknown> = {
  '4034': {
    player_id: '4034',
    first_name: 'Alvin',
    last_name: 'Kamara',
    position: 'RB',
    fantasy_positions: ['RB'],
    team: 'NO',
    status: 'Active',
    injury_status: null,
    number: 41,
    age: 30,
    years_exp: 8,
    search_full_name: 'alvinkamara',
    search_rank: 12,
    active: true,
  },
  '6794': {
    player_id: '6794',
    first_name: 'Justin',
    last_name: 'Jefferson',
    position: 'WR',
    fantasy_positions: ['WR'],
    team: 'MIN',
    status: 'Active',
    injury_status: 'Questionable',
    number: 18,
    age: 26,
    years_exp: 5,
    search_full_name: 'justinjefferson',
    search_rank: 2,
    active: true,
  },
  '4881': {
    player_id: '4881',
    first_name: 'Lamar',
    last_name: 'Jackson',
    position: 'QB',
    fantasy_positions: ['QB'],
    team: 'BAL',
    status: 'Active',
    number: 8,
    age: 29,
    years_exp: 8,
    search_full_name: 'lamarjackson',
    search_rank: 5,
    active: true,
  },
  '1234': {
    player_id: '1234',
    first_name: 'Retired',
    last_name: 'Guy',
    position: 'WR',
    fantasy_positions: ['WR'],
    team: null,
    status: 'Inactive',
    search_full_name: 'retiredguy',
    search_rank: null,
    active: false,
  },
  DET: {
    player_id: 'DET',
    first_name: 'Detroit',
    last_name: 'Lions',
    position: 'DEF',
    fantasy_positions: ['DEF'],
    team: 'DET',
    status: 'Active',
    search_full_name: 'detroitlions',
    search_rank: 140,
    active: true,
  },
};

export const LEAGUE = {
  league_id: '999',
  name: 'Test Dynasty',
  season: '2025',
  season_type: 'regular',
  sport: 'nfl',
  status: 'in_season',
  total_rosters: 2,
  draft_id: '777',
  previous_league_id: null,
  avatar: null,
  roster_positions: ['QB', 'RB', 'WR', 'DEF', 'BN', 'BN'],
  settings: { num_teams: 2, playoff_teams: 2, waiver_budget: 100, waiver_type: 2, leg: 1 },
  scoring_settings: { rec: 1, pass_td: 4, rush_td: 6, rec_td: 6, pass_yd: 0.04, blk_kick: 2, fum_rec_td: 6 },
};

export const USERS = [
  {
    user_id: 'u1',
    username: 'alice',
    display_name: 'Alice',
    avatar: null,
    metadata: { team_name: 'Kamara Sutra' },
    is_owner: true,
  },
  { user_id: 'u2', username: 'bob', display_name: 'Bob', avatar: null, metadata: {} },
];

export const ROSTERS = [
  {
    roster_id: 1,
    owner_id: 'u1',
    league_id: '999',
    players: ['4881', '4034', '6794', 'DET', '1234'],
    starters: ['4881', '4034', '6794', 'DET'],
    reserve: [],
    settings: {
      wins: 1,
      losses: 0,
      ties: 0,
      fpts: 120,
      fpts_decimal: 5,
      fpts_against: 98,
      fpts_against_decimal: 2,
      waiver_budget_used: 15,
      waiver_position: 1,
    },
  },
  {
    roster_id: 2,
    owner_id: 'u2',
    league_id: '999',
    // "0" is how Sleeper represents an unfilled starting slot.
    players: ['4034', '1234'],
    starters: ['0', '4034', '1234', '0'],
    reserve: [],
    settings: {
      wins: 0,
      losses: 1,
      ties: 0,
      fpts: 98,
      fpts_decimal: 2,
      fpts_against: 120,
      fpts_against_decimal: 5,
      waiver_budget_used: 0,
      waiver_position: 2,
    },
  },
];

export const MATCHUPS_WEEK1 = [
  {
    roster_id: 1,
    matchup_id: 1,
    points: 120.5,
    custom_points: null,
    starters: ['4881', '4034', '6794', 'DET'],
    players: ['4881', '4034', '6794', 'DET', '1234'],
    starters_points: [25.4, 30.1, 55.0, 10.0],
  },
  {
    roster_id: 2,
    matchup_id: 1,
    points: 98.2,
    custom_points: null,
    starters: ['0', '4034', '1234', '0'],
    players: ['4034', '1234'],
    starters_points: [0, 30.1, 8.1, 0],
  },
];

export const TRANSACTIONS_WEEK1 = [
  {
    transaction_id: 't1',
    type: 'waiver',
    status: 'complete',
    status_updated: 1700000000000,
    created: 1700000000000,
    creator: 'u1',
    leg: 1,
    roster_ids: [1],
    consenter_ids: [1],
    adds: { '6794': 1 },
    drops: { '1234': 1 },
    draft_picks: [],
    waiver_budget: [],
    settings: { waiver_bid: 15 },
    metadata: null,
  },
  {
    transaction_id: 't2',
    type: 'trade',
    status: 'complete',
    status_updated: 1700000100000,
    created: 1700000100000,
    creator: 'u2',
    leg: 1,
    roster_ids: [2, 1],
    consenter_ids: [2, 1],
    adds: null,
    drops: null,
    draft_picks: [{ season: '2026', round: 1, roster_id: 2, previous_owner_id: 2, owner_id: 1 }],
    waiver_budget: [{ sender: 1, receiver: 2, amount: 25 }],
    settings: null,
    metadata: null,
  },
  {
    transaction_id: 't3',
    type: 'waiver',
    status: 'failed',
    status_updated: 1700000200000,
    created: 1700000200000,
    creator: 'u2',
    leg: 1,
    roster_ids: [2],
    consenter_ids: [2],
    adds: { '4881': 2 },
    drops: null,
    draft_picks: [],
    waiver_budget: [],
    settings: { waiver_bid: 3 },
    metadata: { notes: 'Insufficient budget' },
  },
];

export const DRAFT = {
  draft_id: '777',
  league_id: '999',
  type: 'snake',
  status: 'complete',
  season: '2025',
  season_type: 'regular',
  sport: 'nfl',
  start_time: 1690000000000,
  created: 1690000000000,
  last_picked: 1690000100000,
  draft_order: { u1: 1, u2: 2 },
  slot_to_roster_id: { '1': 1, '2': 2 },
  settings: { teams: 2, rounds: 2 },
  metadata: { scoring_type: 'ppr', name: 'Test Dynasty' },
};

export const DRAFT_PICKS = [
  { draft_id: '777', player_id: '6794', picked_by: 'u1', roster_id: '1', round: 1, draft_slot: 1, pick_no: 1, is_keeper: null },
  { draft_id: '777', player_id: '4034', picked_by: 'u2', roster_id: '2', round: 1, draft_slot: 2, pick_no: 2, is_keeper: true },
  { draft_id: '777', player_id: '4881', picked_by: 'u2', roster_id: '2', round: 2, draft_slot: 2, pick_no: 3, is_keeper: null },
];

export const STATE = {
  week: 1,
  leg: 1,
  season: '2025',
  season_type: 'regular',
  previous_season: '2024',
  season_start_date: '2025-09-04',
  display_week: 1,
  league_season: '2025',
  league_create_season: '2025',
  season_has_scores: true,
};

/**
 * A dynasty league with a taxi squad and an IR slot.
 *
 * Modelled on a real league that exposed a bug the simple fixture could not:
 * `roster.players` is the union of starters + bench + taxi + IR, so computing
 * bench as "players minus starters" counts taxi and IR players as bench. Here
 * roster 1 has 5 players total - 2 starting, 1 on taxi, 1 on IR - so a correct
 * bench is exactly 1.
 */
export const DYNASTY_LEAGUE = {
  league_id: '888',
  name: 'Taxi Squad Dynasty',
  season: '2025',
  season_type: 'regular',
  sport: 'nfl',
  status: 'in_season',
  total_rosters: 2,
  draft_id: '666',
  previous_league_id: null,
  avatar: null,
  roster_positions: ['QB', 'RB', 'BN', 'TAXI', 'IR'],
  settings: { num_teams: 2, taxi_slots: 1, reserve_slots: 1, type: 2 },
  scoring_settings: { rec: 0.5, pass_td: 4, rush_td: 6, rec_td: 6 },
};

export const DYNASTY_USERS = [
  { user_id: 'd1', username: 'dynastyowner', display_name: 'Dynasty Owner', avatar: null, metadata: {} },
  { user_id: 'd2', username: 'rival', display_name: 'Rival', avatar: null, metadata: {} },
];

export const DYNASTY_ROSTERS = [
  {
    roster_id: 1,
    owner_id: 'd1',
    league_id: '888',
    // Union of every player: 2 starting, 1 bench, 1 taxi, 1 IR.
    players: ['4881', '4034', '6794', '1234', 'DET'],
    starters: ['4881', '4034'],
    taxi: ['1234'],
    reserve: ['DET'],
    settings: { wins: 1, losses: 0, ties: 0, fpts: 100, fpts_decimal: 0 },
  },
  {
    roster_id: 2,
    owner_id: 'd2',
    league_id: '888',
    players: ['6794'],
    starters: ['6794', '0'],
    taxi: [],
    reserve: [],
    settings: { wins: 0, losses: 1, ties: 0, fpts: 50, fpts_decimal: 0 },
  },
];

export const DYNASTY_MATCHUPS_WEEK1 = [
  {
    roster_id: 1,
    matchup_id: 1,
    points: 100,
    custom_points: null,
    starters: ['4881', '4034'],
    // Matchup payloads carry taxi/IR players too, so bench must be derived
    // against the roster rather than this list.
    players: ['4881', '4034', '6794', '1234', 'DET'],
    starters_points: [60, 40],
  },
  {
    roster_id: 2,
    matchup_id: 1,
    points: 50,
    custom_points: null,
    starters: ['6794', '0'],
    players: ['6794'],
    starters_points: [50, 0],
  },
];

const ROUTES: Record<string, unknown> = {
  '/user/alice': { user_id: 'u1', username: 'alice', display_name: 'Alice', avatar: null },
  '/user/u1': { user_id: 'u1', username: 'alice', display_name: 'Alice', avatar: null },
  '/user/u1/leagues/nfl/2025': [LEAGUE],
  '/user/u1/drafts/nfl/2025': [DRAFT],
  '/league/999': LEAGUE,
  '/league/999/rosters': ROSTERS,
  '/league/999/users': USERS,
  '/league/999/matchups/1': MATCHUPS_WEEK1,
  '/league/999/matchups/2': [],
  '/league/999/transactions/1': TRANSACTIONS_WEEK1,
  '/league/999/traded_picks': [{ season: '2026', round: 1, roster_id: 2, previous_owner_id: 2, owner_id: 1 }],
  '/league/999/winners_bracket': [{ r: 1, m: 1, t1: 1, t2: 2, w: null, l: null }],
  '/league/999/losers_bracket': [],
  '/league/999/drafts': [DRAFT],
  '/draft/777': DRAFT,
  '/draft/777/picks': DRAFT_PICKS,
  '/draft/777/traded_picks': [],
  '/league/888': DYNASTY_LEAGUE,
  '/league/888/rosters': DYNASTY_ROSTERS,
  '/league/888/users': DYNASTY_USERS,
  '/league/888/matchups/1': DYNASTY_MATCHUPS_WEEK1,
  '/state/nfl': STATE,
  '/players/nfl': PLAYERS,
  '/players/nfl/trending/add': [
    { player_id: '6794', count: 5000 },
    { player_id: 'unknown-id', count: 100 },
  ],
};

export interface StubOptions {
  /** Paths that should behave as missing. */
  notFound?: string[];
}

export interface FetchStub {
  fetch: typeof fetch;
  /** Every path requested, in order — lets tests assert on caching. */
  calls: string[];
}

/** A fetch stub serving the fixture league. Unknown paths 404 like Sleeper does. */
export function makeFetchStub(opts: StubOptions = {}): FetchStub {
  const calls: string[] = [];
  const notFound = new Set(opts.notFound ?? []);

  const stub = (async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const path = url.pathname.replace(/^\/v1/, '');
    calls.push(path + (url.search || ''));

    if (notFound.has(path)) {
      return new Response('null', { status: 404, headers: { 'content-type': 'application/json' } });
    }

    // Sleeper answers an unknown *username* with HTTP 200 and a literal `null`.
    if (path.startsWith('/user/') && path.split('/').length === 3 && !(path in ROUTES)) {
      return new Response('null', { status: 200, headers: { 'content-type': 'application/json' } });
    }

    const body = ROUTES[path];
    if (body === undefined) {
      return new Response('null', { status: 404, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;

  return { fetch: stub, calls };
}
