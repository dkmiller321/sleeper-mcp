/**
 * Domain types for the Sleeper API.
 *
 * All of these are deliberately permissive (`[key: string]: unknown`). Sleeper
 * ships undocumented fields without notice — `/state/nfl` currently returns a
 * `season_has_scores` flag that appears nowhere in the docs — so nothing here
 * strips unknown keys.
 */

export interface SleeperUser {
  user_id: string;
  username: string | null;
  display_name: string | null;
  avatar: string | null;
  metadata?: { team_name?: string | null; [key: string]: unknown } | null;
  is_owner?: boolean | null;
  [key: string]: unknown;
}

export interface League {
  league_id: string;
  name: string;
  season: string;
  season_type: string;
  sport: string;
  status: string;
  total_rosters: number;
  draft_id: string | null;
  previous_league_id: string | null;
  avatar: string | null;
  roster_positions?: string[];
  settings?: Record<string, unknown>;
  scoring_settings?: Record<string, number>;
  [key: string]: unknown;
}

export interface RosterSettings {
  wins?: number;
  losses?: number;
  ties?: number;
  fpts?: number;
  fpts_decimal?: number;
  fpts_against?: number;
  fpts_against_decimal?: number;
  waiver_position?: number;
  waiver_budget_used?: number;
  total_moves?: number;
  [key: string]: unknown;
}

export interface Roster {
  roster_id: number;
  owner_id: string | null;
  league_id: string;
  players: string[] | null;
  starters: string[] | null;
  reserve: string[] | null;
  taxi?: string[] | null;
  settings?: RosterSettings;
  [key: string]: unknown;
}

export interface Matchup {
  roster_id: number;
  matchup_id: number | null;
  points: number | null;
  custom_points: number | null;
  starters: string[] | null;
  players: string[] | null;
  starters_points?: number[] | null;
  players_points?: Record<string, number> | null;
  [key: string]: unknown;
}

export interface BracketMatch {
  r: number;
  m: number;
  t1: number | null;
  t2: number | null;
  w: number | null;
  l: number | null;
  t1_from?: { w?: number; l?: number } | null;
  t2_from?: { w?: number; l?: number } | null;
  p?: number | null;
  [key: string]: unknown;
}

export interface DraftPickAsset {
  season: string;
  round: number;
  roster_id: number;
  previous_owner_id: number | null;
  owner_id: number;
  [key: string]: unknown;
}

export interface Transaction {
  transaction_id: string;
  type: string;
  status: string;
  status_updated: number | null;
  created: number | null;
  creator: string | null;
  leg: number | null;
  roster_ids: number[];
  consenter_ids: number[] | null;
  adds: Record<string, number> | null;
  drops: Record<string, number> | null;
  draft_picks: DraftPickAsset[] | null;
  waiver_budget: { sender: number; receiver: number; amount: number }[] | null;
  settings: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  [key: string]: unknown;
}

export interface SportState {
  week: number;
  leg: number;
  season: string;
  season_type: string;
  previous_season: string;
  season_start_date: string;
  display_week: number;
  league_season: string;
  league_create_season: string;
  [key: string]: unknown;
}

export interface Draft {
  draft_id: string;
  league_id: string | null;
  type: string;
  status: string;
  season: string;
  season_type: string;
  sport: string;
  start_time: number | null;
  created: number | null;
  last_picked: number | null;
  draft_order: Record<string, number> | null;
  slot_to_roster_id: Record<string, number> | null;
  settings?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface DraftPick {
  draft_id: string;
  player_id: string;
  picked_by: string | null;
  roster_id: number | string | null;
  round: number;
  draft_slot: number;
  pick_no: number;
  is_keeper: boolean | null;
  metadata?: Record<string, unknown> | null;
  [key: string]: unknown;
}

export interface TrendingPlayer {
  player_id: string;
  count: number;
}
