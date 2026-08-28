# Sleeper MCP Server — Design

Wraps the [Sleeper API](https://docs.sleeper.com/) as an MCP server.
Stack: TypeScript + `@modelcontextprotocol/sdk`, stdio transport.
Scope: all documented endpoints + derived tools that join data locally.

## 1. What the API actually is

- Base: `https://api.sleeper.app/v1`
- **Read-only, no auth, no API token.** Nothing to configure, no secrets.
- Free for non-commercial use; commercial use requires a license from Sleeper.
- Soft rate limit: stay under **1000 calls/min** or risk an IP block.
- CDN for images: `https://sleepercdn.com/avatars/<id>` and `/avatars/thumbs/<id>`.

## 2. Findings from probing the live API (docs are wrong/incomplete)

These drive most of the design decisions below.

| Finding | Evidence | Consequence |
|---|---|---|
| Full player map is **~14.6 MB**, not the 5 MB the docs claim | `GET /players/nfl` → 14,649,488 bytes | Never let this reach the model. Cache to disk, serve via search/lookup tools only. |
| `?position=` + `?active=` filters work and shrink it hard | `?position=QB&active=true` → 435 KB | Use filters for warm-up; still too big to return raw. |
| gzip is supported and worth ~5.5x | same request with `Accept-Encoding: gzip` → 79 KB | Always send the header. |
| Missing **user** returns **HTTP 200** with body `null` | `/user/thisuserdoesnotexist999999` → `200`, `null` | Status code alone is not a validity check — must treat `null` body as not-found. |
| Missing **league** returns `404` with body `null` | `/league/000000000000000000` → `404`, `null` | Error handling must cover both shapes. |
| Undocumented `/stats/nfl/regular/{season}/{week}` and `/projections/nfl/regular/{season}/{week}` return real data | both `200`, ~535–570 KB | Out of scope for v1 (unsupported, may vanish). Noted for later. |
| Current league state | `/state/nfl` → season 2026, `season_type: "pre"`, week 3, `leg: 0` | `leg` is 0 in preseason; don't use it as a week index blindly. |
| `state/nfl` returns an undocumented `season_has_scores` field | live response | Schemas must be permissive — passthrough unknown keys. |
| Docs typo: bracket path is `losers_bracket` | docs body says `loses_bracket` in the HTTP Request line, `losers_bracket` in the curl example | Use `losers_bracket`. |

## 3. The core problem this server exists to solve

Every roster, matchup, and draft response is **opaque player IDs** — `"2307"`, `"4034"`, `"DET"` — plus opaque `roster_id` and `owner_id`. Answering "who's on my team this week" naively means:

1. username → user_id
2. user_id → leagues
3. league → rosters (`owner_id`, arrays of player IDs)
4. league → users (to map `owner_id` → display name)
5. 14.6 MB player map to turn `"2307"` into "Alvin Kamara, RB, NO"

That's 5 calls and a multi-megabyte join per question. A thin 1:1 endpoint wrapper pushes all of it into the model's context. So the server does the joins itself and returns resolved, compact objects.

## 4. Architecture

```
sleeper-mcp/
  package.json
  tsconfig.json
  src/
    index.ts            # server bootstrap, stdio transport, tool registration
    client.ts           # fetch wrapper: base URL, gzip, timeouts, retry/backoff, null→NotFound
    ratelimit.ts        # token bucket, ~600/min (headroom under the 1000 limit)
    cache.ts            # TTL memory cache + on-disk JSON store for the player map
    players.ts          # player map load/refresh + name/position/team indexes + ID→player resolve
    format.ts           # output shaping: trim fat fields, `verbose` escape hatch
    tools/
      users.ts leagues.ts drafts.ts players.ts derived.ts
  test/
```

### Client layer
- `Accept-Encoding: gzip`, 10s timeout, one retry on 5xx/network with jittered backoff.
- `429` → backoff and retry once, then a clear "rate limited" error.
- Normalize both not-found shapes (`404`, and `200` + `null`) into one `NotFoundError`.
- Every response passes through a permissive parse (unknown keys preserved).

### Caching (TTLs)
| Data | TTL | Where |
|---|---|---|
| Player map | **forever** - explicit refresh only | disk (`~/.cache/sleeper-mcp/players-nfl.json`) + memory index |
| `/state/nfl` | 1h | memory |
| League, rosters, users | 5m | memory |
| Matchups | 60s | memory |
| Drafts, draft picks | 5m | memory (completed drafts: 24h) |
| Trending | 15m | memory |

Player map is fetched lazily on first player-resolving call, not at startup — no 15 MB download just because the server booted.

### Output shaping
A raw league object carries a `scoring_settings` block of ~50 float keys and a `settings` block of ~40. Default responses trim these; every tool takes `verbose: boolean` to get the untouched payload.

## 5. Tool surface

### Raw wrappers (1:1 with documented endpoints)
| Tool | Endpoint |
|---|---|
| `get_user` | `/user/{username_or_id}` |
| `get_user_leagues` | `/user/{user_id}/leagues/{sport}/{season}` |
| `get_league` | `/league/{league_id}` |
| `get_league_rosters` | `/league/{league_id}/rosters` |
| `get_league_users` | `/league/{league_id}/users` |
| `get_matchups` | `/league/{league_id}/matchups/{week}` |
| `get_playoff_bracket` | `/league/{league_id}/{winners,losers}_bracket` |
| `get_transactions` | `/league/{league_id}/transactions/{round}` |
| `get_traded_picks` | `/league/{league_id}/traded_picks` |
| `get_nfl_state` | `/state/{sport}` |
| `get_user_drafts` | `/user/{user_id}/drafts/{sport}/{season}` |
| `get_league_drafts` | `/league/{league_id}/drafts` |
| `get_draft` | `/draft/{draft_id}` |
| `get_draft_picks` | `/draft/{draft_id}/picks` |
| `get_draft_traded_picks` | `/draft/{draft_id}/traded_picks` |
| `get_trending_players` | `/players/{sport}/trending/{add,drop}` |

Plus two cache-management tools with no endpoint of their own: `get_player_data_status` (snapshot age) and `refresh_players` (force re-download).

`GET /players/{sport}` gets **no** raw tool. It is replaced by:
- `search_players(query?, position?, team?, active?, limit=25)` — searches the cached map by name/position/team.
- `lookup_players(player_ids[])` — resolves a batch of IDs to compact player records.

### Derived tools (the reason for this server)
| Tool | Does |
|---|---|
| `find_leagues(username, season?)` | username → user_id → leagues in one hop. The normal entry point. |
| `get_standings(league_id)` | rosters ⋈ users, sorted by W-L-T then points-for, with team names and FAAB left. |
| `get_roster(league_id, team)` | one team by username / display name / roster_id: starters and bench split out, every player named with position, team, injury status. |
| `get_matchup_report(league_id, week?)` | week defaults to current from `/state/nfl`. Pairs teams by `matchup_id`, resolves names both sides, computes bench, shows the margin. |
| `get_transaction_feed(league_id, week?)` | transactions with player IDs, roster IDs, and FAAB moves resolved to names. |
| `get_draft_board(draft_id)` | picks arranged round × slot, named, with keeper flags. |

### Resources
- `sleeper://nfl/state` — current season/week, so the model can orient without a tool call.

## 6. Build order — complete

All six steps are done and the server is built, tested and verified against the live API.

1. ~~`client.ts` + `ratelimit.ts` + `cache.ts`~~
2. ~~`players.ts`~~ — cold load measured at 418ms for 12,225 players; warm load from disk 16ms
3. ~~Raw wrappers + `index.ts`~~ — 26 tools registered
4. ~~Derived tools~~
5. ~~`format.ts` trimming pass + `verbose` flags~~
6. ~~README~~

**Verification:** 62 unit/integration tests (every tool driven through a real MCP client over an in-memory transport), 7 live smoke tests against the real API, plus a real-stdio handshake against the compiled `dist/index.js`.

**Measurements taken during the build:**

| | |
|---|---|
| Raw player map | 14.6 MB / 12,225 players |
| Slim projection on disk | 3.07 MB |
| Cold load (fetch + project + index) | 418 ms |
| Warm load from disk | 16 ms |
| Heap after load | ~61 MB |

## 7. Resolved during the build
- **Slot labels vs. player positions.** `QB: Lamar Jackson (QB, BAL)` says QB twice. `slottedLine()` drops the position when the slot already implies it, but keeps it for FLEX slots where it is the useful part.
- **Point fields.** Sleeper splits scores across `fpts`/`fpts_decimal`; `combinePoints()` recombines them.
- **`"0"` starters.** An unfilled lineup slot is the player ID `"0"`, not an absent entry. Marked `empty: true` rather than resolved.
- **Windows entrypoint check.** `import.meta.url === "file://" + process.argv[1]` never matches on Windows; uses `pathToFileURL`.

## 8. Still open
- Multi-sport: `/state/{sport}` accepts nba, lcs, etc., but leagues/players are NFL-only in practice. v1 hardcodes `nfl` with sport as an optional param where the API takes one.
- Should `find_leagues` cache the username → user_id mapping? Usernames change; user_ids don't. Currently cached by user_id only.
- Undocumented `/stats` and `/projections` endpoints remain unwrapped.
