# sleeper-mcp

An MCP server for the [Sleeper](https://docs.sleeper.com/) fantasy sports API.

Read-only, no API key, no account linking — Sleeper's API is public and unauthenticated.

## Why this isn't a thin wrapper

Every Sleeper response is opaque IDs. A roster comes back as `["4881", "4034", "6794", "DET"]`, a matchup
identifies teams by `roster_id`, and a transaction keys adds and drops by player ID. Turning any of that into
something readable requires `GET /players/nfl` — **14.6 MB**, or 12,225 players.

So answering "who's on my team this week" from the raw endpoints is five calls plus a multi-megabyte join.
This server does the join itself and hands back resolved names, which is what the **derived tools** below are for.

## Install

```bash
npm install && npm run build
```

Register it with Claude Code:

```bash
claude mcp add sleeper -- node /absolute/path/to/sleeper-mcp/dist/index.js
```

Or add it to an MCP client config directly:

```json
{
  "mcpServers": {
    "sleeper": { "command": "node", "args": ["/absolute/path/to/sleeper-mcp/dist/index.js"] }
  }
}
```

## Tools

### Start here

| Tool | What it does |
|---|---|
| `sleeper_find_leagues` | Username → user_id → their leagues, in one call. The normal entry point. |

### Derived — IDs already resolved to names

| Tool | What it does |
|---|---|
| `sleeper_get_standings` | Standings with team names, records, points for/against, FAAB remaining |
| `sleeper_get_roster` | One team by username / display name / nickname / roster_id; starters labelled with their lineup slot, bench split out |
| `sleeper_get_matchup_report` | Head-to-head for a week, both lineups named, margin computed. Defaults to the current week |
| `sleeper_get_transaction_feed` | Trades, waivers and FA moves with players, teams, FAAB and picks all resolved |
| `sleeper_get_draft_board` | A draft laid out round by round with keeper flags |

### Players

| Tool | What it does |
|---|---|
| `sleeper_search_players` | Search by name, position, team, active status |
| `sleeper_lookup_players` | Resolve a batch of player IDs to names |
| `sleeper_get_trending_players` | Most added/dropped across all Sleeper leagues, named |
| `sleeper_get_player_data_status` | When the player snapshot was pulled and whether it's stale |
| `sleeper_refresh_players` | Re-download the player map on demand |

### Raw endpoint wrappers

One per documented endpoint, for when you want the untouched payload:
`sleeper_get_user`, `sleeper_get_user_leagues`, `sleeper_get_league`, `sleeper_get_league_rosters`,
`sleeper_get_league_users`, `sleeper_get_matchups`, `sleeper_get_playoff_bracket`, `sleeper_get_transactions`,
`sleeper_get_traded_picks`, `sleeper_get_nfl_state`, `sleeper_get_user_drafts`, `sleeper_get_league_drafts`,
`sleeper_get_draft`, `sleeper_get_draft_picks`, `sleeper_get_draft_traded_picks`.

There is deliberately **no** raw wrapper for `GET /players/nfl` — it would put 14.6 MB into the model's context.

### Resource

`sleeper://nfl/state` — current season and week, so the model can orient without spending a tool call.

## Player data: fetched once, refreshed on command

The player map is downloaded **once**, projected down to the fields that matter (3.07 MB instead of 14.6 MB),
written to disk, and then **kept indefinitely**. Restarts reuse it. Nothing re-downloads it on a timer.

That's the right default because the two halves of the data age very differently:

| Field | Changes | Trustworthy after weeks? |
|---|---|---|
| `player_id`, `name`, `position` | Effectively never | Yes |
| `injury_status`, `team`, `status`, `depth_chart_order` | Daily | **No** |

So the server tracks the snapshot's age. Once it passes 24 hours, `sleeper_search_players` and
`sleeper_lookup_players` attach a `player_data` block telling the model exactly which fields it can no longer
trust and to call `sleeper_refresh_players`. Names never go stale; injury designations do, and the model is
told which is which rather than being left to assume.

Run `sleeper_refresh_players` to update. Sleeper asks that the full map be pulled at most once per day.

Cache location:
- Windows: `%LOCALAPPDATA%\sleeper-mcp\cache\`
- macOS/Linux: `~/.cache/sleeper-mcp/`

Override with `SLEEPER_MCP_CACHE_DIR`. To restore time-based auto-refresh instead, set
`SLEEPER_MCP_PLAYER_MAX_AGE_HOURS=24`.

## Notes on the API itself

Things found by probing the live API that the published docs get wrong or omit:

- **A bad username returns HTTP 200 with a body of `null`** (a bad *league* returns 404). Checking status codes
  alone silently treats a typo as success. The client normalizes both into one not-found error.
- The player map is **14.6 MB**, not the 5 MB the docs claim.
- `?position=` and `?active=` filters on `/players` work and are barely documented.
- The docs' HTTP Request line says `loses_bracket`; the working path is `losers_bracket`.
- `/state/nfl` returns an undocumented `season_has_scores` field, so all types here pass unknown keys through.
- `leg` is `0` during the preseason, so it can't be used as a week index unguarded.
- `/stats/nfl/...` and `/projections/nfl/...` return real data but appear nowhere in the docs. Not wrapped here.

Sleeper's rate limit is ~1000 calls/min before an IP block; the client self-limits to 600/min.

## Development

```bash
npm test
```

62 tests: HTTP error handling, caching, rate limiting, the player index, and every tool driven through a real
MCP client over an in-memory transport.

```bash
SLEEPER_MCP_LIVE=1 npm run test:live
```

Smoke tests against the real Sleeper API. Set `SLEEPER_MCP_TEST_USER` to a real Sleeper username to also
exercise the league-scoped tools against a live league.

## License

MIT. Sleeper's API is free for non-commercial use; commercial use requires a license from Sleeper.
