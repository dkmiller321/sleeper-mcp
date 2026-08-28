import type { Player } from './players.js';
import type { League, Roster, SleeperUser } from './types.js';

/**
 * Output shaping.
 *
 * A raw league object carries a `scoring_settings` block of ~50 float keys and a
 * `settings` block of ~40. Dumping those into a model's context on every call is
 * pure noise, so tools trim by default and take `verbose: true` to opt out.
 */

/** Scoring keys that actually distinguish one league's format from another. */
const KEY_SCORING = [
  'rec',
  'bonus_rec_te',
  'pass_td',
  'pass_int',
  'rush_td',
  'rec_td',
  'fum_lost',
  'pass_yd',
  'rush_yd',
  'rec_yd',
] as const;

const KEY_SETTINGS = [
  'num_teams',
  'playoff_teams',
  'playoff_week_start',
  'waiver_type',
  'waiver_budget',
  'trade_deadline',
  'type',
  'best_ball',
  'taxi_slots',
  'reserve_slots',
  'leg',
] as const;

function pick<T extends Record<string, unknown>>(source: T | undefined, keys: readonly string[]): Record<string, unknown> | undefined {
  if (!source) return undefined;
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null) out[key] = source[key];
  }
  return Object.keys(out).length ? out : undefined;
}

/** Human-readable scoring format inferred from the reception value. */
export function scoringFormat(league: League): string {
  const rec = league.scoring_settings?.rec;
  if (rec === undefined || rec === null) return 'unknown';
  if (rec >= 1) return 'PPR';
  if (rec > 0) return `${rec} PPR`;
  return 'standard';
}

export function summarizeLeague(league: League, verbose = false): Record<string, unknown> {
  if (verbose) return league;
  return {
    league_id: league.league_id,
    name: league.name,
    season: league.season,
    status: league.status,
    sport: league.sport,
    total_rosters: league.total_rosters,
    scoring_format: scoringFormat(league),
    roster_positions: league.roster_positions,
    draft_id: league.draft_id,
    previous_league_id: league.previous_league_id,
    settings: pick(league.settings, KEY_SETTINGS),
    scoring_settings: pick(league.scoring_settings, KEY_SCORING),
  };
}

/** Compact player line: enough to reason about, small enough to repeat 200x. */
export function summarizePlayer(player: Player): Record<string, unknown> {
  const out: Record<string, unknown> = {
    player_id: player.player_id,
    name: player.name,
    position: player.position,
    team: player.team,
  };
  if (player.injury_status) out.injury_status = player.injury_status;
  if (player.status && player.status !== 'Active') out.status = player.status;
  return out;
}

export function summarizePlayers(players: Player[]): Record<string, unknown>[] {
  return players.map(summarizePlayer);
}

/** "Alvin Kamara (RB, NO)" — for places where a whole object is overkill. */
export function playerLine(player: Player, opts: { omitPosition?: boolean } = {}): string {
  const parts = [opts.omitPosition ? null : player.position, player.team].filter(Boolean).join(', ');
  const injury = player.injury_status ? ` [${player.injury_status}]` : '';
  return parts ? `${player.name} (${parts})${injury}` : `${player.name}${injury}`;
}

/**
 * A starter prefixed with its lineup slot. The position is dropped when the slot
 * already implies it — "QB: Lamar Jackson (QB, BAL)" says QB twice — but kept for
 * FLEX and similar slots where it is the useful part.
 */
export function slottedLine(slot: string, player: Player): string {
  return `${slot}: ${playerLine(player, { omitPosition: slot === player.position })}`;
}

/** Points are split across integer and decimal fields; recombine them. */
export function combinePoints(whole?: number | null, decimal?: number | null): number {
  return Number(`${whole ?? 0}.${decimal ?? 0}`);
}

export function teamName(user: SleeperUser | undefined, roster: Roster | undefined): string {
  const nickname = typeof user?.metadata?.team_name === 'string' ? user.metadata.team_name.trim() : '';
  if (nickname) return nickname;
  if (user?.display_name) return user.display_name;
  if (user?.username) return user.username;
  return roster ? `Roster ${roster.roster_id}` : 'Unknown team';
}

export function record(roster: Roster): string {
  const s = roster.settings ?? {};
  const ties = s.ties ?? 0;
  return ties ? `${s.wins ?? 0}-${s.losses ?? 0}-${ties}` : `${s.wins ?? 0}-${s.losses ?? 0}`;
}
