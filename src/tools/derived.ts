import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { SleeperApi } from '../api.js';
import { combinePoints, playerLine, record, scoringFormat, slottedLine, teamName } from '../format.js';
import type { League, Matchup, Roster, SleeperUser, Transaction } from '../types.js';
import { fail, guard, ok, type ToolResult } from './util.js';

/**
 * Derived tools.
 *
 * These exist because every Sleeper response is opaque IDs. Answering "who is on
 * my team this week" from the raw endpoints costs five calls and a join against a
 * 15MB player map. Doing that join here instead of in the model's context is the
 * whole point of this server.
 */

interface LeagueContext {
  league: League;
  rosters: Roster[];
  users: SleeperUser[];
  userById: Map<string, SleeperUser>;
  rosterById: Map<number, Roster>;
  nameFor: (rosterId: number) => string;
}

async function loadLeague(api: SleeperApi, leagueId: string): Promise<LeagueContext> {
  const [league, rosters, users] = await Promise.all([
    api.getLeague(leagueId),
    api.getRosters(leagueId),
    api.getLeagueUsers(leagueId),
  ]);
  const userById = new Map(users.map((u) => [u.user_id, u]));
  const rosterById = new Map(rosters.map((r) => [r.roster_id, r]));
  return {
    league,
    rosters,
    users,
    userById,
    rosterById,
    nameFor: (rosterId: number) => {
      const roster = rosterById.get(rosterId);
      return teamName(roster?.owner_id ? userById.get(roster.owner_id) : undefined, roster);
    },
  };
}

/** Starting slot labels, in order, derived from the league's roster_positions. */
function starterSlots(league: League, count: number): string[] {
  const bench = new Set(['BN', 'TAXI', 'IR']);
  const slots = (league.roster_positions ?? []).filter((p) => !bench.has(p));
  return Array.from({ length: count }, (_, i) => slots[i] ?? 'FLEX');
}

/**
 * Finds one team in a league by roster_id, username, display name, or team
 * nickname. Matching is case-insensitive and falls back to a substring match so
 * that "kamara guy" style partial names still land.
 */
function findRoster(ctx: LeagueContext, needle: string): Roster | undefined {
  const q = needle.trim().toLowerCase();

  const asId = Number.parseInt(q, 10);
  if (String(asId) === q && ctx.rosterById.has(asId)) return ctx.rosterById.get(asId);

  const candidates = ctx.rosters.map((roster) => {
    const user = roster.owner_id ? ctx.userById.get(roster.owner_id) : undefined;
    const nickname = typeof user?.metadata?.team_name === 'string' ? user.metadata.team_name : '';
    return {
      roster,
      keys: [user?.username, user?.display_name, nickname, roster.owner_id]
        .filter((v): v is string => typeof v === 'string' && v.length > 0)
        .map((v) => v.toLowerCase()),
    };
  });

  return (
    candidates.find((c) => c.keys.some((k) => k === q))?.roster ??
    candidates.find((c) => c.keys.some((k) => k.includes(q)))?.roster
  );
}

/**
 * Active bench: everything on the roster that is not starting, not on the taxi
 * squad, and not on IR.
 *
 * `roster.players` is the union of ALL of those, so a plain "players minus
 * starters" subtraction silently counts taxi and IR players as bench. In a
 * dynasty league with a full taxi squad that inflates the bench by more than
 * double.
 */
function benchIds(roster: Roster, starterIds: readonly string[]): string[] {
  const excluded = new Set<string>([...starterIds, ...(roster.taxi ?? []), ...(roster.reserve ?? [])]);
  return (roster.players ?? []).filter((id) => !excluded.has(id));
}

function describeRoster(ctx: LeagueContext, roster: Roster, api: SleeperApi) {
  const starterIds = roster.starters ?? [];
  const slots = starterSlots(ctx.league, starterIds.length);
  const starters = api.players.resolve(starterIds).map((player, i) => ({
    slot: slots[i],
    ...(player.player_id === '0' ? { empty: true } : {}),
    player_id: player.player_id,
    name: player.name,
    position: player.position,
    team: player.team,
    ...(player.injury_status ? { injury_status: player.injury_status } : {}),
  }));

  const bench = api.players.resolve(benchIds(roster, starterIds)).map((p) => ({
    player_id: p.player_id,
    name: p.name,
    position: p.position,
    team: p.team,
    ...(p.injury_status ? { injury_status: p.injury_status } : {}),
  }));

  const settings = roster.settings ?? {};
  return {
    roster_id: roster.roster_id,
    team: ctx.nameFor(roster.roster_id),
    owner_id: roster.owner_id,
    record: record(roster),
    points_for: combinePoints(settings.fpts, settings.fpts_decimal),
    points_against: combinePoints(settings.fpts_against, settings.fpts_against_decimal),
    waiver_budget_used: settings.waiver_budget_used ?? 0,
    counts: {
      starters: starters.length,
      bench: bench.length,
      taxi: roster.taxi?.length ?? 0,
      reserve: roster.reserve?.length ?? 0,
    },
    starters,
    bench,
    reserve: roster.reserve?.length ? api.players.resolve(roster.reserve).map((p) => playerLine(p)) : [],
    taxi: roster.taxi?.length ? api.players.resolve(roster.taxi).map((p) => playerLine(p)) : [],
  };
}

export function registerDerivedTools(server: McpServer, api: SleeperApi): void {
  server.registerTool(
    'sleeper_find_leagues',
    {
      title: 'Find a user leagues',
      description:
        'Start here. Takes a username and returns their leagues for a season, resolving the username to a user_id along the way. Season defaults to the current league season.',
      inputSchema: {
        username: z.string().describe('Sleeper username (or user_id)'),
        season: z.string().optional().describe('Season year; defaults to the current league season'),
        sport: z.string().default('nfl'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    ({ username, season, sport }) =>
      guard(async () => {
        const [user, state] = await Promise.all([api.getUser(username), api.getState(sport)]);
        const targetSeason = season ?? state.league_season ?? state.season;
        const leagues = await api.getUserLeagues(user.user_id, targetSeason, sport);
        return ok({
          user: { user_id: user.user_id, username: user.username, display_name: user.display_name },
          season: targetSeason,
          league_count: leagues.length,
          leagues: leagues.map((l) => ({
            league_id: l.league_id,
            name: l.name,
            status: l.status,
            total_rosters: l.total_rosters,
            scoring_format: scoringFormat(l),
            draft_id: l.draft_id,
          })),
        });
      }),
  );

  server.registerTool(
    'sleeper_get_standings',
    {
      title: 'Get league standings',
      description:
        'League standings with team names, records, points for/against and FAAB remaining. Joins rosters against users so nothing comes back as a bare roster_id.',
      inputSchema: { league_id: z.string() },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    ({ league_id }) =>
      guard(async () => {
        const ctx = await loadLeague(api, league_id);
        const waiverBudget = Number(ctx.league.settings?.waiver_budget ?? 0);

        const rows = ctx.rosters
          .map((roster) => {
            const s = roster.settings ?? {};
            return {
              roster_id: roster.roster_id,
              team: ctx.nameFor(roster.roster_id),
              wins: s.wins ?? 0,
              losses: s.losses ?? 0,
              ties: s.ties ?? 0,
              record: record(roster),
              points_for: combinePoints(s.fpts, s.fpts_decimal),
              points_against: combinePoints(s.fpts_against, s.fpts_against_decimal),
              ...(waiverBudget
                ? { faab_remaining: waiverBudget - Number(s.waiver_budget_used ?? 0) }
                : { waiver_position: s.waiver_position ?? null }),
            };
          })
          .sort((a, b) => b.wins - a.wins || a.losses - b.losses || b.points_for - a.points_for)
          .map((row, i) => ({ rank: i + 1, ...row }));

        return ok({ league: ctx.league.name, season: ctx.league.season, standings: rows });
      }),
  );

  server.registerTool(
    'sleeper_get_roster',
    {
      title: 'Get one team roster',
      description:
        'One team in a league, identified by username, display name, team nickname or roster_id. Returns starters (labelled with their lineup slot) and bench, every player resolved to name, position, team and injury status.',
      inputSchema: {
        league_id: z.string(),
        team: z.string().describe('Username, display name, team nickname, or roster_id'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    ({ league_id, team }): Promise<ToolResult> =>
      guard(async () => {
        const ctx = await loadLeague(api, league_id);
        const roster = findRoster(ctx, team);
        if (!roster) {
          const known = ctx.rosters.map((r) => `${r.roster_id}: ${ctx.nameFor(r.roster_id)}`).join(', ');
          return fail(`No team matching "${team}" in this league. Teams are: ${known}`);
        }
        await api.players.ensureLoaded();
        return ok(describeRoster(ctx, roster, api));
      }),
  );

  server.registerTool(
    'sleeper_get_matchup_report',
    {
      title: 'Get weekly matchup report',
      description:
        'Head-to-head matchups for a week, with both lineups resolved to player names and the margin computed. Week defaults to the current NFL week.',
      inputSchema: {
        league_id: z.string(),
        week: z.number().int().min(1).max(22).optional().describe('Defaults to the current week'),
        include_bench: z.boolean().default(false),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    ({ league_id, week, include_bench }) =>
      guard(async () => {
        const targetWeek = week ?? (await api.currentWeek());
        const [ctx, matchups] = await Promise.all([loadLeague(api, league_id), api.getMatchups(league_id, targetWeek)]);
        await api.players.ensureLoaded();

        if (!matchups.length) {
          return ok({ league: ctx.league.name, week: targetWeek, matchups: [], note: 'No matchups posted for this week.' });
        }

        const describeSide = (m: Matchup) => {
          const starterIds = m.starters ?? [];
          const slots = starterSlots(ctx.league, starterIds.length);
          const points = m.custom_points ?? m.points ?? 0;
          const side: Record<string, unknown> = {
            roster_id: m.roster_id,
            team: ctx.nameFor(m.roster_id),
            points,
            starters: api.players.resolve(starterIds).map((p, i) => {
              const line = slottedLine(slots[i], p);
              const scored = m.starters_points?.[i];
              return scored === undefined || scored === null ? line : `${line} - ${scored}`;
            }),
          };
          if (include_bench) {
            // Use the roster (not the matchup row) for taxi/IR, which the
            // matchup payload does not carry.
            const roster = ctx.rosterById.get(m.roster_id);
            const excluded = new Set<string>([
              ...starterIds,
              ...(roster?.taxi ?? []),
              ...(roster?.reserve ?? []),
            ]);
            side.bench = api.players
              .resolve((m.players ?? []).filter((id) => !excluded.has(id)))
              .map((p) => playerLine(p));
          }
          return side;
        };

        // Rows sharing a matchup_id play each other; a null matchup_id means the
        // team is unscheduled that week (byes, odd team counts, some playoff formats).
        const grouped = new Map<number, Matchup[]>();
        const unscheduled: Matchup[] = [];
        for (const m of matchups) {
          if (m.matchup_id === null || m.matchup_id === undefined) unscheduled.push(m);
          else {
            const list = grouped.get(m.matchup_id) ?? [];
            list.push(m);
            grouped.set(m.matchup_id, list);
          }
        }

        const pairs = [...grouped.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([matchupId, sides]) => {
            const teams = sides.map(describeSide);
            const scores = sides.map((s) => s.custom_points ?? s.points ?? 0);
            return {
              matchup_id: matchupId,
              margin: teams.length === 2 ? Math.abs(Math.round((scores[0] - scores[1]) * 100) / 100) : null,
              leader:
                teams.length === 2 && scores[0] !== scores[1]
                  ? ctx.nameFor(sides[scores[0] > scores[1] ? 0 : 1].roster_id)
                  : null,
              teams,
            };
          });

        return ok({
          league: ctx.league.name,
          week: targetWeek,
          matchups: pairs,
          ...(unscheduled.length
            ? { unscheduled: unscheduled.map((m) => ctx.nameFor(m.roster_id)) }
            : {}),
        });
      }),
  );

  server.registerTool(
    'sleeper_get_transaction_feed',
    {
      title: 'Get transaction feed',
      description:
        'Trades, waiver claims and free-agent moves for a week, with player IDs, roster IDs and FAAB transfers resolved to names. Week defaults to the current NFL week.',
      inputSchema: {
        league_id: z.string(),
        week: z.number().int().min(1).max(22).optional(),
        status: z.enum(['all', 'complete', 'failed']).default('complete'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    ({ league_id, week, status }) =>
      guard(async () => {
        const targetWeek = week ?? (await api.currentWeek());
        const [ctx, transactions] = await Promise.all([
          loadLeague(api, league_id),
          api.getTransactions(league_id, targetWeek),
        ]);
        await api.players.ensureLoaded();

        const named = (playerId: string) => playerLine(api.players.resolve([playerId])[0]);
        const movement = (map: Record<string, number> | null | undefined) =>
          Object.entries(map ?? {}).map(([playerId, rosterId]) => `${named(playerId)} -> ${ctx.nameFor(rosterId)}`);

        const rows = transactions
          .filter((t: Transaction) => status === 'all' || t.status === status)
          .map((t: Transaction) => {
            const bid = t.settings?.waiver_bid;
            return {
              transaction_id: t.transaction_id,
              type: t.type,
              status: t.status,
              week: t.leg,
              created: t.created ? new Date(t.created).toISOString() : null,
              teams: (t.roster_ids ?? []).map((id) => ctx.nameFor(id)),
              ...(bid !== undefined && bid !== null ? { waiver_bid: bid } : {}),
              adds: movement(t.adds),
              drops: movement(t.drops),
              ...(t.draft_picks?.length
                ? {
                    picks: t.draft_picks.map(
                      (p) => `${p.season} round ${p.round} (${ctx.nameFor(p.roster_id)}) -> ${ctx.nameFor(p.owner_id)}`,
                    ),
                  }
                : {}),
              ...(t.waiver_budget?.length
                ? {
                    faab: t.waiver_budget.map(
                      (w) => `$${w.amount}: ${ctx.nameFor(w.sender)} -> ${ctx.nameFor(w.receiver)}`,
                    ),
                  }
                : {}),
            };
          });

        return ok({ league: ctx.league.name, week: targetWeek, count: rows.length, transactions: rows });
      }),
  );

  server.registerTool(
    'sleeper_get_draft_board',
    {
      title: 'Get draft board',
      description:
        'A draft laid out round by round with every pick resolved to a player name, plus which team made it and whether it was a keeper.',
      inputSchema: {
        draft_id: z.string(),
        round: z.number().int().min(1).max(30).optional().describe('Limit to one round'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    ({ draft_id, round }) =>
      guard(async () => {
        const [draft, picks] = await Promise.all([api.getDraft(draft_id), api.getDraftPicks(draft_id)]);
        await api.players.ensureLoaded();

        // Team names need the league; a draft can exist without one (mock drafts).
        let nameFor: (rosterId: number) => string = (id) => `Roster ${id}`;
        if (draft.league_id) {
          try {
            const ctx = await loadLeague(api, draft.league_id);
            nameFor = ctx.nameFor;
          } catch {
            // Mock or deleted league - fall back to roster ids.
          }
        }

        const selected = round ? picks.filter((p) => p.round === round) : picks;
        const rounds = new Map<number, unknown[]>();
        for (const pick of selected) {
          const player = api.players.resolve([pick.player_id])[0];
          const rosterId = typeof pick.roster_id === 'string' ? Number.parseInt(pick.roster_id, 10) : pick.roster_id;
          const list = rounds.get(pick.round) ?? [];
          list.push({
            pick_no: pick.pick_no,
            slot: pick.draft_slot,
            team: Number.isFinite(rosterId) ? nameFor(rosterId as number) : null,
            player: playerLine(player),
            player_id: pick.player_id,
            ...(pick.is_keeper ? { keeper: true } : {}),
          });
          rounds.set(pick.round, list);
        }

        return ok({
          draft_id,
          type: draft.type,
          status: draft.status,
          season: draft.season,
          teams: draft.settings?.teams ?? null,
          rounds: draft.settings?.rounds ?? null,
          total_picks: selected.length,
          board: [...rounds.entries()]
            .sort((a, b) => a[0] - b[0])
            .map(([r, list]) => ({ round: r, picks: list })),
        });
      }),
  );
}
