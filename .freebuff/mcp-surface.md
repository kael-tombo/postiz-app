# Postiz MCP surface (verified on the live stack)

## Mounts (backend :3000, Express layer — not in swagger)
| Path | Auth | Notes |
|---|---|---|
| `/mcp` | `Authorization: Bearer <apiKey or pos_ token>` | streamable HTTP, JSON responses |
| `/mcp/:apiKey` | key in path | streamable HTTP |
| `/sse/:apiKey` + `/message/:apiKey` | key in path | legacy SSE transport |
| `/mcp-oauth-dynamic` | OAuth (DCR + PKCE) | full toolset |
| `/mcp-oauth` | OAuth | kept for old connectors |
| `/mcp-oauth-chatgpt` | OAuth, pre-defined client | no DCR advertised |
| `/mcp-oauth-claude` | OAuth | hides AI media tools (directory rules) |

Discovery: `/.well-known/oauth-protected-resource/<path>` (RFC 9728) and
`/.well-known/oauth-authorization-server/mcp-oauth-dynamic` (RFC 8414).
DCR: `POST /oauth/register` (RFC 7591, public clients use `token_endpoint_auth_method: none`).
Token: `POST /oauth/token` with `code_verifier` (S256 PKCE) → `pos_` bearer.

## Tool registry (26 tools; `name` is the MCP wire name)
Agentic lifecycle:
- `integrationList`, `groupList` — discover channels/groups
- `integrationSchema` — per-provider settings + rules (call before scheduling)
- `freeDateTimeTool` — next free slot (org or per channel)
- `mediaListTool` — browse/search media library (`path` = attachment)
- `integrationSchedulePostTool` — create draft/scheduled/now posts
- `postsListTool` — list posts in a window (paginated; attachments, publish error, threadParts, `state` filter)
- `postSettingsTool` — merge provider settings (unpublished only)
- `postContentTool` — edit text/media of an unpublished post in place (state + date preserved)
- `postDateTool` — reschedule (`update` default; `schedule` republishes)
- `postStatusTool` — cancel to draft / re-queue
- `integrationAnalyticsTool`, `postAnalyticsTool` — channel/post metrics
- `uploadFromUrlTool`, `triggerTool` — media upload / provider triggers
- `generateImageTool`, `generateVideoTool`, `videoStatusTool`, `generateVideoOptions`, `videoFunctionTool` — AI media (hidden on the Claude mount)
- `clippingTool`, `clippingStatusTool`, `clippingWidgetTicketTool` — video clipping
- `uploadWidgetTool`, `uploadWidgetTicketTool`, `uploadWidgetStatusTool` — MCP Apps widgets (mcpOnly)

## Gotchas learned while testing
- Write tools (schedule/edit/settings/date/status) are rate-limited per org:
  30 writes / minute (redis fixed window); refusals come back as `output.errors`
  with a retry hint. One call counts once even if it batches many posts.
- `postsListTool` returns max 20 posts per call (`page`, `total`, `hasMore`).
- Mastra `createTool({ id })` ≠ MCP name: the class `name` field wins on the wire
  (e.g. `integrationSchedulePostTool`, not `schedulePostTool`; `integrationList`, not `integrationListTool`).
- Tool output is wrapped: `result.structuredContent.output` (Mastra), fall back to text block JSON.
- `mediaListTool` `thumbnail` can be null with local storage.
- WordPress (article) channels have no `analytics()` — empty array is the correct answer.
- Each `initialize` returns a fresh `mcp-session-id`; send it on subsequent calls.

## Test suites (.freebuff/, plain node)
| Suite | Coverage | Status |
|---|---|---|
| `mcp-analytics-test.mjs` | 41 checks: transports, auth, tools, agentic loop, TZ round-trip, content edit | 41/41 |
| `mcp-oauth-test.mjs` | 22 checks: full OAuth client flow (DCR→PKCE→token→MCP), negatives, Claude variant | 22/22 |
| `feature-tests.mjs` | 57 REST contract checks | 57/57 |
| `post-lifecycle-test.mjs` | 16: mock WP → Temporal → PUBLISHED | 16/16 |
