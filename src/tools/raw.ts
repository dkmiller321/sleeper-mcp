import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { SleeperApi } from '../api.js';
import { summarizeLeague, summarizePlayers } from '../format.js';
import { guard, ok } from './util.js';

const sportArg = z.string().default('nfl').describe('Sport key. Sleeper only really supports "nfl".');
const verboseArg = z
  .boolean()
  .default(false)
  .describe('Return the full untrimmed payload including all scoring/settings keys.');

/** 1:1 wrappers over the documented Sleeper endpoints. */
export function registerRawTools(server: McpServer, api: SleeperApi): void {
  server.registerTool(
    'sleeper_get_user',
    {
      title: 'Get Sleeper user',
      description:
        'Look up a Sleeper user by username or numeric user_id. Returns user_id, username, display_name and avatar. Usernames change over time; store the user_id.',
      inputSchema: { username_or_id: z.string().describe('Sleeper username or numeric user_id') },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    ({ username_or_id }) => guard(async () => ok(await api.getUser(username_or_id))),
  );

  server.registerTool(
    'sleeper_get_user_leagues',
    {
      title: 'Get leagues for a user',
      description:
        'List every league a user belongs to in a given season. Requires a numeric user_id (use sleeper_get_user or sleeper_find_leagues to resolve a username).',
      inputSchema: {
        user_id: z.string().describe('Numeric Sleeper user_id'),
        season: z.string().describe('Season year, e.g. "2025"'),
        sport: sportArg,
        verbose: verboseArg,
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    ({ user_id, season, sport, verbose }) =>
      guard(async () => {
        const leagues = await api.getUserLeagues(user_id, season, sport);
        return ok(leagues.map((l) => summarizeLeague(l, verbose)));
      }),
  );

  server.registerTool(
    'sleeper_get_league',
    {
      title: 'Get a league',
      description:
        'Fetch one league by ID: name, season, status, roster positions and scoring format. Pass verbose=true for the full settings and scoring_settings blocks.',
      inputSchema: { league_id: z.string(), verbose: verboseArg },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    ({ league_id, verbose }) => guard(async () => ok(summarizeLeague(await api.getLeague(league_id), verbose))),
  );

  server.registerTool(
    'sleeper_get_league_rosters',
    {
      title: 'Get league rosters',
      description:
        'Raw rosters for a league. Player fields are opaque IDs - prefer sleeper_get_standings or sleeper_get_roster, which resolve them to names.',
      inputSchema: { league_id: z.string() },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    ({ league_id }) => guard(async () => ok(await api.getRosters(league_id))),
  );

  server.registerTool(
    'sleeper_get_league_users',
    {
      title: 'Get league users',
      description:
        'All users in a league with display_name, avatar, commissioner flag, and the team nickname in metadata.team_name.',
      inputSchema: { league_id: z.string() },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    ({ league_id }) => guard(async () => ok(await api.getLeagueUsers(league_id))),
  );

  server.registerTool(
    'sleeper_get_matchups',
    {
      title: 'Get raw matchups',
      description:
        'Raw matchup rows for one week; each row is one team, and the two rows sharing a matchup_id play each other. Player IDs are unresolved - prefer sleeper_get_matchup_report.',
      inputSchema: { league_id: z.string(), week: z.number().int().min(1).max(22) },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    ({ league_id, week }) => guard(async () => ok(await api.getMatchups(league_id, week))),
  );

  server.registerTool(
    'sleeper_get_playoff_bracket',
    {
      title: 'Get playoff bracket',
      description:
        'Winners or losers playoff bracket. Each row is a matchup: r=round, m=match id, t1/t2=roster_ids, w/l=results, t1_from/t2_from show where teams advance from.',
      inputSchema: {
        league_id: z.string(),
        bracket: z.enum(['winners', 'losers']).default('winners'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    ({ league_id, bracket }) => guard(async () => ok(await api.getBracket(league_id, bracket))),
  );

  server.registerTool(
    'sleeper_get_transactions',
    {
      title: 'Get raw transactions',
      description:
        'Raw trades, waivers and free-agent moves for one week. Adds/drops are keyed by opaque player ID - prefer sleeper_get_transaction_feed.',
      inputSchema: {
        league_id: z.string(),
        week: z.number().int().min(1).max(22).describe('Week (the API calls this "round")'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    ({ league_id, week }) => guard(async () => ok(await api.getTransactions(league_id, week))),
  );

  server.registerTool(
    'sleeper_get_traded_picks',
    {
      title: 'Get traded draft picks',
      description:
        'Every traded draft pick in a league including future seasons. roster_id is the original owner, owner_id is the current owner.',
      inputSchema: { league_id: z.string() },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    ({ league_id }) => guard(async () => ok(await api.getTradedPicks(league_id))),
  );

  server.registerTool(
    'sleeper_get_nfl_state',
    {
      title: 'Get current NFL state',
      description:
        'Current season, week and season_type (pre/regular/post). Call this first when a question says "this week" or "current season".',
      inputSchema: { sport: sportArg },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    ({ sport }) => guard(async () => ok(await api.getState(sport))),
  );

  // --- Drafts ------------------------------------------------------------

  server.registerTool(
    'sleeper_get_user_drafts',
    {
      title: 'Get drafts for a user',
      description: 'All drafts a user participated in for a season.',
      inputSchema: { user_id: z.string(), season: z.string(), sport: sportArg },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    ({ user_id, season, sport }) => guard(async () => ok(await api.getUserDrafts(user_id, season, sport))),
  );

  server.registerTool(
    'sleeper_get_league_drafts',
    {
      title: 'Get drafts for a league',
      description:
        'All drafts for a league, most recent first. Dynasty leagues have one per season; redraft leagues usually have exactly one.',
      inputSchema: { league_id: z.string() },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    ({ league_id }) => guard(async () => ok(await api.getLeagueDrafts(league_id))),
  );

  server.registerTool(
    'sleeper_get_draft',
    {
      title: 'Get a draft',
      description:
        'One draft by ID, including draft_order (user_id to slot) and slot_to_roster_id (slot to roster_id).',
      inputSchema: { draft_id: z.string() },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    ({ draft_id }) => guard(async () => ok(await api.getDraft(draft_id))),
  );

  server.registerTool(
    'sleeper_get_draft_picks',
    {
      title: 'Get raw draft picks',
      description: 'Every pick in a draft in order. Prefer sleeper_get_draft_board for a readable round-by-round view.',
      inputSchema: { draft_id: z.string() },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    ({ draft_id }) => guard(async () => ok(await api.getDraftPicks(draft_id))),
  );

  server.registerTool(
    'sleeper_get_draft_traded_picks',
    {
      title: 'Get traded picks in a draft',
      description: 'Picks that changed hands within a specific draft.',
      inputSchema: { draft_id: z.string() },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    ({ draft_id }) => guard(async () => ok(await api.getDraftTradedPicks(draft_id))),
  );

  // --- Players -----------------------------------------------------------

  server.registerTool(
    'sleeper_search_players',
    {
      title: 'Search players',
      description:
        'Search the NFL player map by name, position and/or team. This replaces the raw /players endpoint, which returns a ~15MB blob. The map is downloaded once and cached on disk indefinitely; use sleeper_refresh_players to update it.',
      inputSchema: {
        query: z.string().optional().describe('Full or partial player name'),
        position: z.string().optional().describe('QB, RB, WR, TE, K, DEF, ...'),
        team: z.string().optional().describe('Team abbreviation, e.g. KC'),
        active: z.boolean().optional().describe('Restrict to active players'),
        limit: z.number().int().min(1).max(100).default(25),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (args) =>
      guard(async () => {
        await api.players.ensureLoaded();
        const results = api.players.search(args);
        const status = api.players.status();
        return ok({
          count: results.length,
          players: summarizePlayers(results),
          ...(status.stale ? { player_data: status } : {}),
        });
      }),
  );

  server.registerTool(
    'sleeper_lookup_players',
    {
      title: 'Look up players by ID',
      description:
        'Resolve a batch of Sleeper player IDs (e.g. "4034", "DET") to names, positions, teams and injury status.',
      inputSchema: { player_ids: z.array(z.string()).min(1).max(500) },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    ({ player_ids }) =>
      guard(async () => {
        await api.players.ensureLoaded();
        const status = api.players.status();
        const players = summarizePlayers(api.players.resolve(player_ids));
        return ok(status.stale ? { players, player_data: status } : players);
      }),
  );

  server.registerTool(
    'sleeper_get_player_data_status',
    {
      title: 'Check player data freshness',
      description:
        'Reports when the cached player snapshot was downloaded and whether its volatile fields (injury_status, team, status) should still be trusted. Names and positions stay accurate regardless of age.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    () =>
      guard(async () => {
        await api.players.ensureLoaded();
        return ok(api.players.status());
      }),
  );

  server.registerTool(
    'sleeper_refresh_players',
    {
      title: 'Refresh player data',
      description:
        'Re-download the ~15MB Sleeper player map, replacing the cached snapshot. The map is otherwise fetched once and kept forever, so run this when injury designations or team changes look out of date. Sleeper asks that this be called at most once per day.',
      inputSchema: {},
      annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: true },
    },
    () =>
      guard(async () => {
        const before = api.players.status();
        const after = await api.players.refresh();
        return ok({
          refreshed: true,
          previous_snapshot: before.fetched_at,
          ...after,
        });
      }),
  );

  server.registerTool(
    'sleeper_get_trending_players',
    {
      title: 'Get trending players',
      description:
        'Most-added or most-dropped players across all Sleeper leagues, resolved to names. Good proxy for waiver-wire buzz.',
      inputSchema: {
        type: z.enum(['add', 'drop']).default('add'),
        lookback_hours: z.number().int().min(1).max(168).default(24),
        limit: z.number().int().min(1).max(100).default(25),
        sport: sportArg,
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    ({ type, lookback_hours, limit, sport }) =>
      guard(async () => {
        const trending = await api.getTrending(type, { sport, lookbackHours: lookback_hours, limit });
        await api.players.ensureLoaded();
        return ok(
          trending.map((t) => {
            const player = api.players.get(t.player_id);
            return {
              player_id: t.player_id,
              name: player?.name ?? t.player_id,
              position: player?.position ?? null,
              team: player?.team ?? null,
              injury_status: player?.injury_status ?? null,
              [type === 'add' ? 'adds' : 'drops']: t.count,
            };
          }),
        );
      }),
  );
}
