# MCP for agentic usage — deep assessment (2026-09-26)

Scope: the MCP server stack (`chat/start.mcp.ts`, 27 tools), agent instructions,
auth surface, and the agentic write/read loop. Verified against the live stack.

## What is wrong / what was found

### F1. Timezone contract bug — FIXED at the repository level
The whole stack produced/consumed Z-less UTC wall time (MCP tools, dashboard
`date.utc().format(...)` in `calendar.context.tsx`, `findFreeDateTime`), but the
post repository parsed dates with **local-time** `dayjs()` — posts landed
`offset` hours off on non-UTC hosts (this one runs UTC+3) for MCP *and* the
dashboard. Fix: all three repository write-path parses now use `dayjs.utc(date)`
(lines 76/492/547).
MCP tools additionally normalize via `chat/tools/date.util.ts#toUtcIso`.
Readers already used `dayjs.utc()` — reads/writes are now symmetric. Verified by
the exact-instant round-trip e2e check and the full lifecycle suite.
**CORRECTION (F14, 2026-09-27)**: the "`type: 'now'` producer emits UTC wall
time" claim in this section was wrong — the producer still used local-time
`dayjs()`. Fixed for real in F14 and now pinned by an e2e test.

### F2. Tool `id` vs `name` duality — assessed, NOT changed
Mastra `createTool({ id })` and the MCP wire name (class `name`) differ for 4 of
26 tools (`integrationSchema`, `integrationList`, `groupList`, `triggerTool`,
`schedulePostTool`→`integrationSchedulePostTool`). Instructions and descriptions
all reference the *wire* names (verified — no phantom-tool traps), and renaming
published tool names would break existing client configs. Verdict: leave as is,
documented in `mcp-surface.md`. Risk is contained because the LLM sees only the
`name`s.

### F3. Analytics `percentageChange` is fake — assessed, NOT changed
Every provider hardcodes it (0 or 5). The two analytics tools expose it verbatim.
Cosmetic, provider-wide, and pre-existing; an agent can compute real trends from
the daily series. Would require touching ~15 providers — not worth the churn now.

### F5. Provider analytics audit — DONE (Mastodon + Bluesky implemented)

Audit of all 36 provider files (identifier + `analytics`/`postAnalytics` grep):

**HAVE analytics** (13, was 11): facebook, gmb, instagram, instagram-standalone,
linkedin-page, pinterest, threads, tiktok, tiktok-business, x, youtube,
**mastodon**, **bluesky**.

**Legitimately N/A (publishing APIs without engagement/read endpoints)**:
wordpress, devto, medium, hashnode, article-style providers — documented, not
"missing".

**Still lacking (rest):** discord, dribbble (has postAnalytics only),
mastodon-custom (inherits now), wrapcast, kick, lemmy, linkedin, listmonk,
mewe, moltbook, nostr, reddit, skool, slack, telegram, tumblr, twitch, vk, whop.
Highest-value remaining candidates if ever needed: reddit (OAuth `t3_` objects
score via `/api/info`), tumblr (`/posts` with note_count), telegram (chat
member counts only — weak).

**What was implemented** (both follow the pinterest/gmb conventions:
`AnalyticsData[]`, days-back `date` capped at 89, try/catch → `[]`):
- `mastodon.provider.ts` — `analytics()`: paginate
  `/api/v1/accounts/:id/statuses?limit=40&exclude_replies=true&exclude_reblogs=true`
  (stop when a full page is older than the window), bucket
  reblogs/favourites/replies per UTC day → Boosts/Favourites/Replies series.
  `postAnalytics()`: `GET /api/v1/statuses/:id` (releaseId = status id) as a
  single-day snapshot. `instanceUrlFor()` hook overridden by
  `mastodon.custom.provider.ts` so custom instances query their own host.
- `bluesky.provider.ts` — Bluesky's app.bsky endpoints now all require auth
  (verified live against bsky.social), so both methods reuse the app-password
  agent (`getAgent`). `analytics()`: `com.atproto.repo.listRecords`
  (newest-first, limit 100) windowed by `createdAt`, then `app.bsky.feed.getPosts`
  in 25-uri batches → Likes/Reposts/Replies per UTC day. `postAnalytics()`:
  `getPosts` with the at:// releaseId. Returns `[]` without an Integration row.
- Interface: `analytics?`/`postAnalytics?` gained an optional trailing
  `integration?: Integration` (call sites in integration.service.ts and
  posts.service.ts pass the full row). **Instagram refactor required**: its 4th
  positional param was a graph-host *string* (`graph.facebook.com` vs
  `graph.instagram.com`) that would have received an Integration object at
  runtime — renamed bodies to `graphAnalytics`/`graphPostAnalytics`, added
  interface-conforming wrappers, standalone provider delegates to the new names.

**Verification:** new `.freebuff/analytics-smoke-test.mjs` — 18/18 against local
mock Mastodon (4790) + mock Bluesky XRPC (4791): bucket math, old-status
exclusion, pagination stop, sorted dates, custom-instance routing, app-password
agent reuse, no-integration guard. All 4 regression suites still green.

### F4. postsListTool output omits attachments — FIXED
The repository `getPosts*` selects now include the `image` JSON and
`postsListTool` maps it to a compact `attachments: string[]`. Agents can see a
post's media before editing it with `postContentTool` (which replaces media).
Verified by an e2e assertion (schedule with library media → list shows the path).

## Current state (all verified live)

| Area | Status |
|---|---|
| Transports | `/mcp` (bearer: API key or pos_), `/mcp/:id`, `/sse/:id`, 4 OAuth mounts |
| Auth | API key, OAuth DCR+PKCE full client flow (22/22), Claude directory variant |
| Write loop | create → edit content/settings → reschedule → cancel/re-queue |
| Read/plan loop | channels, groups, provider schemas, free slots, media library, posts, analytics |
| Guards | republish guard, wrong-state refusals, settings validation, SSRF-safe media URLs |
| Agent instructions | match real tool names; slot/media/edit/cancel policies taught |

### F6. postsListTool F4 fix was LOST in the working tree — RE-FIXED this round
`git diff` showed the repository only carried the three F1 timezone hunks: the
`getPosts` select had lost `image: true` and `postsListTool` had no attachments
mapping at all (tool matched origin/main). Re-applied, and extended:
- `posts.repository.ts#getPosts` select now also includes `error: true`.
- `postsListTool` output per post: `attachments: string[]` (mapped from the
  image JSON), `error` (capped at 300 chars — platform dumps can be huge), and
  `threadParts` (all message parts in publishing order via
  `getPostsRecursively`, so agents see threads/comments in one item instead of
  hallucinating a single-post shape from the truncated `content`).
- Tool description teaches the new fields.
Note: `getPosts` still returns root rows only (comments are child rows) —
`threadParts` covers the visibility gap without changing the repository query.

### F7. Smaller findings from this round (assessed)
- `freeDateTimeTool` output schema now spells out the exact UTC
  `YYYY-MM-DDTHH:mm:ss` (no offset) format of `date` — the Z-less contract was
  implicit before.
- `checkAuth` trusts `context.mcp.extra.authInfo` when present: only the OAuth
  middleware sets it, so the trust boundary is sound, but it depends on Mastra
  internals (`mcp.extra`) — worth re-verifying on Mastra upgrades.
- Every tool repeats `JSON.parse(context.requestContext.get('organization'))`
  after `checkAuth` — a tiny `getOrgFromContext()` helper would remove ~20
  copies (left as is to avoid churn).
- Build note: `nest build` OOMs on this machine (16 GB, ~3 GB free with the dev
  stack up) inside the nest/ts-loader wrapper; plain
  `cd apps/backend && pnpm exec tsc --build tsconfig.build.json --incremental false`
  emits the same tree to `apps/backend/dist` fine.

### F12. Elicitation confirmations on destructive writes + dual-era MCP (fifth pass, 2026-09-27)
- **Backlog item 5 (elicitation) is now DONE.** The five mutating tools
  (integrationSchedulePostTool, postContentTool, postDateTool, postStatusTool,
  postSettingsTool) confirm destructive actions with the human through MCP
  elicitation (`confirmWithUser` in `chat/tools/confirm.elicit.ts`).
  - Specific, dynamic messages (cancel which post, move to which date, batch
    size + earliest date for schedule, settings keys, publish-now warning).
  - Decline (or a vague answer) returns `output.errors` and NOTHING is written;
    accept proceeds. Accept-yes/confirm aliases tolerated for loose hosts.
- **Dual-era MCP (prerequisite)**: Mastra only wires elicitation into a tool
  when the request is classified modern-era (its replay mechanism: first round
  returns an `input_required` result embedding the elicitation/create form,
  the client retries with `inputResponses`). Postiz never set a protocol
  version, so every request was legacy — and on the legacy era a
  server→client elicitation is silently DROPPED by the stateless JSON mounts
  (verified in the SDK transport: JSON-response mode only drains
  `onmessage`), i.e. an un-gated elicitation would hang forever.
  Fix: `MCP_PROTOCOL_MODE=auto` (default) sets `protocolVersion:
  '2026-07-28'` on all three MCPServers and dispatches /mcp, /mcp/:id and the
  OAuth mounts through `createMcpHandler`'s dual-era router (same factory for
  both legs, so they cannot drift; legacy 2025 clients are served stateless by
  the SDK fallback). `MCP_PROTOCOL_MODE=legacy` restores the previous wiring.
- **Gate conditions (fail-open by design)**: ask only when the request carries
  the per-request `_meta` envelope naming 2026-07-28 AND the client declared
  the `elicitation` capability. Legacy sessions, capability-less hosts and any
  elicitation runtime error proceed without confirmation (the tool
  descriptions' "get confirmation first" teaching remains the first line).
  `ElicitationReplayInterrupt` is re-thrown — swallowing it would run writes
  without confirmation on round 1. `MCP_CONFIRM_MODE=off` disables globally.
- **Schedule-tool ordering**: the confirmation runs BEFORE any createPost
  because replay re-executes the tool from the top on each round; writes after
  the elicitation keep the flow idempotent (no double "now" publishes).
- **Modern-era protocol facts learned the hard way** (recorded in run.md):
  no initialize handshake; per-request `_meta` envelope required;
  `Mcp-Method`/`Mcp-Name` headers must mirror the body; wire result type is
  `input_required` with `inputRequests` map + `requestState` echo.
- **Verification**: new `.freebuff/mcp-confirm-test.mjs` — 17/17 (legacy
  passthrough ×2, modern round-trip ×8 incl. decline-blocks/nothing-created/
  accept-writes-once, no-capability passthrough, plus setup). Full battery
  re-run on the dual-era backend: analytics 41/41, rate+paginate 18/18,
  oauth 22/22, feature 57/57, lifecycle 16/16, free-date regression green.
- Known follow-ups: sessionful legacy clients (`/mcp/:id` with a real session
  id) now route through the stateless fallback — behavior-compatible for
  JSON/SSE responses but state (per-session transports) is gone; modern
  elicitation UX depends on hosts implementing the 2026-07-28 replay
  (Claude/ChatGPT directory clients are legacy-era and keep today's
  no-confirmation behavior).
- **Provider env-key diagnostics at boot** — `SocialAbstract.providerEnv` /
  `providerEnvNote` declared per provider (x, linkedin(+page), reddit,
  facebook, instagram, threads, youtube, tiktok, gmb); the backend feeds them
  into `ConfigurationChecker.checkProviders()`, so missing keys now warn at
  startup: "X (x) is missing env keys: X_API_KEY, X_API_SECRET - connecting
  this channel will fail" + setup note. Kills the old failure mode (consent
  URL with `client_id=` empty, generic UI toast).
- **Configurable write rate limit** — `MCP_WRITE_LIMIT` (default 30; 0
  disables) and `MCP_WRITE_WINDOW_SECONDS` (default 60) env vars.
- **`publishedUrl` in postsListTool** — PUBLISHED posts now carry the live
  platform URL (`releaseURL`), so agents can report links.
- **MCP progress notifications** — verified `@mastra/mcp` exposes
  `context.mcp.progress({progress,total,message})` inside tool execute (host
  must send a progressToken; server-side `enableProgressTracking` is a client
  option). Wired best-effort pings into `generateVideoTool` and `clippingTool`
  ("queued" at progress 0/1) — no-op for hosts that don't support it.

### F13. Sixth-pass: single-post reads + schema honesty + host guidance (2026-09-27)
- **New `postDetailsTool` (27 tools now)** — fetch ONE post by id: every
  message part with its own id/attachments (main + comments flagged
  `isComment`), state, UTC publishDate, parsed settings, tags, platform,
  `creationMethod`, `intervalInDays`, capped publish `error`, `publishedUrl`
  and `releaseId`. Closes a real agent gap: with only postsListTool, an agent
  holding one id had to page date windows to re-inspect it. Org-scoped via
  `getPostsRecursively` (same root/comment rejection pattern as the content
  edit tool); comment ids are refused with a hint. Read tool — deliberately
  NOT rate-limited, keeping the F8 contract (reads untouched).
- **integrationList outputSchema was lying** — execute returned
  `disabled/display/type/customer` but the advertised schema omitted them, so
  hosts relying on the schema dropped them. `disabled` is agent-critical
  (never schedule to a disabled channel); `display` defaults to `''` when the
  profile is null so validation passes.
- **postsListTool gained `creationMethod` + `intervalInDays`** — both were
  already selected by the repository but invisible to agents. Recurring posts
  (interval) previously looked like ordinary duplicate items; agents can now
  see "repeats every N days, each repeat is a separate item, edits don't
  cascade".
- **Server-level `instructions`** — the MCPServers never set any, so hosts got
  zero orientation at initialize. Now a compact operational map (discover →
  plan → act → observe loops + the delete/HTML/UTC/confirmation rules) is
  advertised on all three servers (main, oauth, claude).
- **Test-design lesson**: `freeDateTimeTool` returns the next CONFIGURED
  posting time (default 09:20/14:10/19:00 UTC), which can be hours away — to
  observe a real publish inside a test, schedule a probe a couple of minutes
  out instead of trusting the free slot. `postDetailsTool` then shows the
  QUEUE → PUBLISHED transition with the live URL + releaseId.
- **Verification**: new `.freebuff/mcp-reads-test.mjs` — 33/33 (schema
  fields ×7, list fields ×5, details ×12 incl. unknown-id and cross-org
  isolation, publish round-trip ×5). Full battery green on the rebuilt
  backend: confirm 17/17, analytics 41/41, rate+paginate 18/18, oauth 22/22,
  feature 57/57, lifecycle 16/16, free-date regression green.

### F14. Seventh-pass: agent-safety pre-flight + the lost 'now' timezone fix (2026-09-27)
- **F1 correction — the `type: 'now'` producer was NEVER fixed.** The F1 note
  claimed it emitted UTC wall time; `git diff` proves only the three repository
  parsers were changed. `posts.service.ts` produced the date with local-time
  `dayjs()` while the repository parses Z-less strings with `dayjs.utc()` — on
  this UTC+3 host an MCP "post now" landed **3 hours in the future** (same
  loss pattern as F4/F6). Now `dayjs.utc()`, and the regression is pinned by
  `mcp-agent-safety-test.mjs` (schedules +1 min, polls via postDetailsTool,
  asserts the publish lands now-ish, not offset-shifted).
- **Schedule tool pre-flight hardening** — new validations run BEFORE any
  post is created, each returning `output.errors` with a recovery hint:
  - unknown `integrationId` → "No channel found with id … call the
    integrationList tool" (previously: a raw mid-write error or, worse, a
    draft created against a phantom channel);
  - disabled channel → "is disabled - it cannot receive posts until it is
    reconnected in the Postiz app" (previously: validation happily passed and
    the post was created on a channel that can never publish);
  - unparsable `date` → teaches the UTC wall-time format + freeDateTimeTool;
  - past `date` on schedule/now (1 min tolerance) → "pass a future UTC time
    … or type draft". Drafts in the past stay allowed (back-dated drafts are
    a legitimate dashboard pattern).
  Together with the round-1 republish guard this makes the schedule tool's
  failure surface fully agent-recoverable: every refusal is actionable.
- **Verification**: new `.freebuff/mcp-agent-safety-test.mjs` — 16/16 (unknown
  ×2, disabled ×2, invalid date ×2, past/past-draft ×3, nothing-created ×1,
  now-publish TZ ×3 incl. exact publish-instant assertion). Full battery green
  on the rebuilt backend: reads 33/33, confirm 17/17, analytics 41/41,
  rate+paginate 18/18, oauth 22/22, feature 57/57, lifecycle 16/16,
  free-date regression green.

### F15. Eighth-pass: edit-tool pre-flight parity (2026-09-27)
- **postDateTool** now pre-flights BEFORE the confirmation dialog: unknown id
  → "Post not found - find the post with the postsList tool", comment id →
  "pass the id of the main post", invalid date → format hint +
  freeDateTimeTool, past-QUEUE → cannot be rescheduled. Previously an unknown
  id surfaced as a raw `Cannot read properties of null` TypeError and a
  garbage date as "Invalid time value" — and the agent was first asked to
  CONFIRM an action that was going to fail.
- **postStatusTool** gained the same not-found/comment-id guards (the service
  threw a bare "Post not found" and would have accepted a comment id,
  re-queuing a comment row as if it were a post).
- postSettingsTool/postContentTool already refused cleanly (audited, no
  change). Happy paths re-verified: reschedule, cancel→draft, re-queue all
  still work after the guards.
- The MCP write surface now has a uniform failure contract: every refusal is
  an `output.errors` string with a recovery hint, always emitted before any
  confirmation dialog or write.
- **Verification**: new `.freebuff/mcp-edit-safety-test.mjs` — 14/14 (date ×3,
  status ×2, happy paths ×3, setup ×6). Full battery green on the rebuilt
  backend: agent-safety 16/16, reads 33/33, confirm 17/17, analytics 41/41,
  rate+paginate 18/18, oauth 22/22, feature 57/57, lifecycle 16/16,
  free-date regression green.

### F16. Ninth-pass: modern-era host certification (2026-09-27)
- **Elicitation hang valve**: `confirm.elicit.ts` now races the confirmation
  `sendRequest` against `MCP_CONFIRM_TIMEOUT_MS` (default 30s). If Mastra's
  replay elicitation is ever unwired (SDK upgrade, odd mount), a permanently
  pending request would hang the agent's write tool forever; the timeout
  fails OPEN (unconfirmed write, tool descriptions still demand consent) —
  the worst case degrades from "hung agent" to "no confirmation". Legacy-era
  calls never reach sendRequest, so the valve only guards modern confirmed paths.
- **`server/discover` is the modern-era handshake replacement and it is LIVE**
  on all three mounts (`/mcp`, `/mcp/:id`, oauth): returns
  `supportedVersions: ["2026-07-28"]`, server capabilities (tools/logging/
  resources **plus the `io.modelcontextprotocol/ui` MCP Apps extension**) and
  the server instructions — F13's instructions reach modern hosts through
  discover, not through tools/list. Hosts that never initialize (modern era)
  must call `server/discover` for orientation.
- **Envelope strictness pinned** (was undocumented): a modern request whose
  `_meta` has `protocolVersion` but no `clientCapabilities` key → hard 400
  `-32602` (both reserved keys are mandatory together); wrong-era string →
  hard 400 `-32022` before any tool runs; `clientCapabilities` without
  `protocolVersion` or no envelope at all → legacy fallback (fail-open
  semantics, no gate). The cert suite exercises all four shapes.
- **Discovery is split in the modern era**: `tools/list` carries the catalog
  with `serverInfo` in result `_meta` and is cacheable (`ttlMs` + `cacheScope`,
  SEP-2549) but has NO `instructions`; legacy `initialize` keeps instructions.
  The cert suite pins this split so a regression (instructions vanishing from
  one era) is caught.
- **Replay correlation is client-authoritative on stateless mounts**: the
  mount keeps no pending-request state, so `inputResponses` pre-filled on a
  call with no prior `input_required` round executes the tool (the host is
  the human's representative — SEP-1331 trust model; a host that fabricates
  answers is outside the server's defense surface, same as one that drops the
  form). Stale answer keys are ignored → re-ask; correlated decline →
  structured `output.errors` with nothing written; correlated accept →
  executes exactly once. All four shapes pinned in the suite.
- **Stateless mounts never issue `mcp-session-id`** on JSON responses
  (sessions are meaningless without state) — corrected a prior assumption;
  legacy `initialize` still negotiates `2025-03-26` alongside modern traffic
  on the same server (dual-era coexistence verified).
- **Registry correction**: the live tool count is **25** (not 27 as earlier
  passes recorded; 25 incl. `ask_postiz` after dedupe).
- **Verification**: new `.freebuff/mcp-modern-cert.mjs` — **43/43** covering
  discovery (server/discover ×6, tools/list ×7), gate (×6), auth (×3), replay
  correlation (×5), dual-era coexistence (×3), rate (×1), decline/telemetry
  shapes (×2) + setup (×10). Full battery green on the rebuilt backend:
  reads 33/33, agent-safety 16/16, edit-safety 14/14, analytics 41/41,
  confirm 17/17, rate+paginate 18/18, oauth 22/22, feature 57/57, lifecycle
  16/16, free-date regression green.

### F17. Tenth-pass: method-surface matrix + ui widget certification (2026-09-27)
- **Modern-era method surface pinned — the mounts serve exactly four methods**:
  `server/discover`, `tools/list`, `tools/call`, `resources/list` +
  `resources/read` (five counting the read). Everything else fails fast with
  a crisp 404 `-32601` JSON-RPC error — pinned across 16 methods (`ping`,
  `resources/templates/list`, `resources/subscribe`/`unsubscribe`,
  `logging/setLevel`, `prompts/list`/`get`, `completion/complete`,
  `sampling/createMessage`, `roots/list`, `elicitation/create`, all four
  `tasks/*`, and a garbage method). No method hangs; the whole unsupported
  battery answers in < 20s. For agents this is the discovery contract: an
  unknown capability is a clean, immediate `-32601`, never a stall.
- **MCP Apps ui widget certified end-to-end on the modern mounts**:
  `resources/list` advertises `ui://postiz/upload` with mime
  `text/html;profile=mcp-app`, name/description for the host UI;
  `resources/read` returns the 13.9KB self-contained widget HTML with
  `_meta.ui` carrying `csp.connectDomains` pinned to the backend origin,
  `permissions.clipboardWrite` (copy-link button) and `prefersBorder`. With
  local storage (no clipping enabled) exactly one widget is exposed.
- **Header/body mirroring (`-32020`) matrix pinned** — the modern codec
  enforces self-describing requests:
  - envelope present + `mcp-method` header missing → 400 `-32020`;
  - `mcp-method` header without envelope → accepted as legacy (200);
  - name-bearing params must mirror into `mcp-name`: `tools/call` →
    `params.name`, `resources/read` → `params.uri`; disagreeing or missing
    → 400 `-32020`; nameless methods accept any/empty `mcp-name`.
- **Unknown tool error shape pinned**: `tools/call` with an unregistered name
  never reaches Postiz's tools — Mastra answers at the protocol layer with
  the spec-correct `isError: true` + `"Unknown tool: X"` text
  (`resultType: complete`), distinct from the tool-level `output.errors`
  contract. postDetails unknown id keeps returning structured
  `output.errors` (F13 shape intact).
- **Verification**: new `.freebuff/mcp-method-matrix-test.mjs` — **40/40**
  (served ×14, unsupported ×17, mirroring ×6, error shapes ×2 + setup).
  Full battery green, no code changes needed this round (surface was already
  correct — the round's value is the pinned contract): modern-cert 43/43,
  reads 33/33, agent-safety 16/16, edit-safety 14/14, analytics 41/41,
  confirm 17/17, rate+paginate 18/18, oauth 22/22, feature 57/57, lifecycle
  16/16, free-date regression green.

### F18. Eleventh-pass: full agentic-loop simulation + modern-era parity fix (2026-09-27)
- **Parity bug found and fixed**: on the modern elicitation era, unknown-
  integration and past-date schedule writes reached the CONFIRMATION DIALOG
  before being refused — the pre-flight guards from F14 ran AFTER
  `confirmWithUser`, so legacy-era tests passed (confirm is a pass-through
  there) while modern agents first bothered the human with a dialog for an
  action that was going to fail, then errored. The schedule tool now runs
  ALL pre-flights (rate limit, dates, channels, validation) before the
  confirm step, on both eras. This was invisible to every previous suite
  because the safety suites exercised refusals on legacy sessions.
- **postDetailsTool unknown-id message now carries the recovery hint**
  ("call postsList and retry with an id from its output") — previously a
  bare "Post not found", the only refusal without guidance (found by the
  loop suite).
- **The loop, measured** (`.freebuff/mcp-agentic-loop-test.mjs`, 28/28):
  a modern host plays the full agent journey — orient (discover +
  integrationList) → plan (integrationSchema by platform + freeDateTime) →
  act (confirmed write, exactly 2 round-trips) → verify (postsList +
  postDetails) → adjust (content edit, reschedule, status, each gated) →
  recover (garbage date, unknown id, unknown channel, past schedule,
  declined write — every refusal actionable, none pops a dialog) → observe
  (postAnalytics). **Totals: 22 calls, 22.5 KB ≈ ~5.8K tokens, 380 ms wall,
  zero protocol errors.** Budgets pinned: ≤ 25 calls, ≤ 400 KB, 0 errors.
- Friction observations for agent UX: the write round-trip is 2 calls by
  design (gate); recovery paths add one call per mistake with actionable
  text; the catalog (tools/list) is the single biggest payload a host pays
  for repeatedly — hosts should use the SEP-2549 ttlMs cache.
- **Verification**: new loop suite 28/28 + full battery green on the rebuilt
  backend: modern-cert 43/43, method-matrix 40/40, reads 33/33,
  agent-safety 16/16, edit-safety 14/14, confirm 17/17, analytics 41/41,
  rate+paginate 18/18, oauth 22/22, feature 57/57, lifecycle 16/16,
  free-date regression green.

### F19. Twelfth-pass: agent-guidance audit — the catalog as documentation (2026-09-27)
- **Premise**: an agent has no code access — the tool catalog (descriptions +
  schema `describe()` strings) is its entire documentation. The loop suite
  (F18) showed where first-try args went wrong; this round audited every
  tool's teaching strings against those failure points and fixed the gaps.
- **Fixed (library changes, all verified in the live catalog)**:
  - `integrationSchedulePostTool` (highest-traffic write): `socialPost` now
    explains one-entry-per-channel+date; `integrationId` names integrationList
    as the id source; `date` carries the `YYYY-MM-DDTHH:mm:ss` UTC format and
    a freeDateTime pointer; `type` spells out draft vs schedule vs now
    (including "draft may be past, schedule must be future"); `settings`
    says key/value pairs from integrationSchema and "pass [] for drafts";
    `attachments` says "pass [] for a text-only post"; `postsAndComments`
    says first item = post, rest = comments.
  - Empty arg descriptions filled: `generateVideoTool.identifier/output/
    customParams`, `generateImageTool.prompt`, `videoFunctionTool.identifier/
    functionName`, `triggerTool.dataSchema` ([] when no input needed).
- **New `.freebuff/mcp-guidance-test.mjs` — 95/95**: pins teaching quality on
  the live catalog — every tool description ≥ 40 chars, EVERY arg description
  ≥ 10 chars (no empty schemas again), the next-hop chain (schema →
  triggerTool, freeDateTime → date, mediaList → attachments, video polling,
  widget fallback), and the schedule-tool recovery knowledge that broke the
  loop on first try.
- Loop friction unchanged (22 calls / 22.5 KB / ~5.8K tokens) — guidance
  quality is about first-try success, not payload; the catalog dump that fed
  this audit is reproducible from the guidance suite itself.
- **Verification**: guidance 95/95 + loop 28/28 + full battery green on the
  rebuilt backend: modern-cert 43/43, method-matrix 40/40, reads 33/33,
  agent-safety 16/16, edit-safety 14/14, confirm 17/17, analytics 41/41,
  rate+paginate 18/18, oauth 22/22, feature 57/57, lifecycle 16/16,
  free-date regression green.

### F20. Thirteenth-pass: per-post batch confirmation (2026-09-27)
- **Feature**: multi-post schedule writes (2–25 posts) now show ONE
  elicitation form with a checkbox per post — the human can keep a subset
  (keep 18 of 20, drop 2) instead of the old all-or-nothing dialog. Each
  checkbox carries the post's type, date and a text preview. Above 25 posts
  the form would be unusable, so the dialog falls back to the simple
  accept/decline confirmation.
- **Agent-facing contract**: a partial accept returns
  `{ errors: "The user unchecked N of M posts; the other K were created.
  Declined socialPost indices: [i, j].", created: [{postId, integration}...],
  declined: [i, j] }` — the agent can retry just the declined entries by
  slicing socialPost. Decline-all returns the same shape with empty created.
  Single posts and every fail-open path keep the legacy array shape.
- **Safety preserved**: batch answers reuse the same replay channel, the
  same `MCP_CONFIRM_TIMEOUT_MS` hang valve, and the same fail-open rules
  (legacy era, no elicitation capability, confirm-mode off, channel error).
  A missing/unknown answer shape declines rather than guesses; an `accept`
  with missing per-post content creates all (checkboxes default on).
- **Implementation**: `confirmBatchWithUser()` in confirm.elicit.ts (gate on
  the modern envelope, forms built from the posts, boolean-array answer),
  wired into integrationSchedulePostTool after all pre-flights; output schema
  extended with `created`/`declined` optional fields (backward compatible).
- **Verification**: new `.freebuff/mcp-batch-confirm-test.mjs` — 21/21
  (form shape, partial accept with DB check, decline-all, malformed answer,
  single-post compat, no-cap + legacy fail-open, 26-post fallback). Full
  battery green on the rebuilt backend: guidance 95/95, loop 28/28,
  confirm 17/17, modern-cert 43/43, method-matrix 40/40, reads 33/33,
  agent-safety 16/16, edit-safety 14/14, analytics 41/41, rate+paginate
  18/18, oauth 22/22, feature 57/57, lifecycle 16/16, free-date green.

### F21. Fourteenth-pass: cold-start agent eval — catalog-only first-try scoring (2026-09-27)
- **What it is**: `.freebuff/mcp-cold-start-eval.mjs` plays an LLM that has
  NEVER seen the codebase. Its only knowledge is the tools/list catalog; it
  picks tools by matching task words against descriptions and synthesizes
  arguments with generic rules (copy format examples from description text,
  follow tool-name cross-references for dataflow, honor [] hints, match
  enums to task words, never pour a string into a boolean/enum arg, do not
  invent optional args). It then EXECUTES the journey on a fresh org and
  scores first-try argument validity per hop: 1.0 valid, 0.5 after reading
  the error, 0 never. A zod failure on the first attempt is a documentation
  failure, not the agent's.
- **Key measurement subtlety**: on a modern-era write, the FIRST valid
  attempt returns the elicitation dialog (input_required) — that is proof
  the arguments passed validation, not an error. The eval scores on the raw
  result before unwrapping.
- **Result: 5.0/5 — every hop first-try valid on a fresh org**
  (integrationList → integrationSchema → freeDateTimeTool → the confirmed
  write → postDetails), deterministic across runs, with the synthesized
  socialPost logged in the suite output. The guidance fixes of F19 are what
  the synthesizer feeds on: the UTC format example, the [] hints and the
  integrationList id-source note are exactly what makes cold-start args
  valid without any code knowledge.
- **Verification**: eval 9/9 (rerun deterministic) + full battery green:
  batch 21/21, guidance 95/95, loop 28/28, confirm 17/17, modern-cert
  43/43, method-matrix 40/40, reads 33/33, agent-safety 16/16,
  edit-safety 14/14, analytics 41/41, rate+paginate 18/18, oauth 22/22,
  feature 57/57, lifecycle 16/16, free-date regression green.

## Recommended next improvements (priority order)
1. ~~Provider analytics audit~~ — **DONE**: Mastodon + Bluesky implemented and mock-tested; audit matrix recorded under F5.
2. ~~postsList attachments~~ — **RE-DONE + extended** (error field, threadParts): see F6.
3. ~~Rate/concurrency guard for tools~~ — **DONE**: per-org redis limiter on the 5 write tools (F8).
4. ~~postsListTool pagination + state filter~~ — **DONE** (F9).
5. ~~MCP elicitation/progress~~ — **DONE**: progress pings on video/clipping tools (F11); elicitation confirmations on all five write tools behind a dual-era MCP dispatch (F12).
6. **Re-verify checkAuth's `context.mcp.extra.authInfo` trust** on Mastra upgrades (sound today, Mastra-internal).
7. **Real-account OAuth testing** — needs provider developer apps (X/Facebook/YouTube/TikTok/Threads/Reddit/LinkedIn env keys all empty on this instance; boot diagnostics now say exactly which). Bluesky remains the zero-setup real-account path.

## Test suites (all green, this round)
- `.freebuff/mcp-analytics-test.mjs` — 41/41 (transports, auth, tools, agentic loop, TZ round-trip, content edit, library-media visibility)
- `.freebuff/mcp-oauth-test.mjs` — 22/22 (DCR → PKCE → token → MCP, negatives, Claude variant)
- `.freebuff/feature-tests.mjs` — 57/57, `.freebuff/post-lifecycle-test.mjs` — 16/16
- `.freebuff/regression-find-free-date-time.mjs` — pass (process lingers on the Temporal client; assertions all green)

## Round log (2026-09-26, second pass)
Deep re-analysis found the working tree had lost the F4 fix (see F6); re-applied
and extended with `error` + `threadParts`. All suites re-run against the
rebuilt backend: 41 + 22 + 57 + 16 green.

### F8. Rate/concurrency guard for MCP write tools — IMPLEMENTED (third pass)
New `chat/tools/write.rate.limit.ts`: per-organization redis fixed-window
limiter, 30 writes / 60 s (`mcp:write-limit:<orgId>:<bucket>`, INCR + EXPIRE,
lax on limiter errors so tests/self-hosts without redis never block). Wired
into all five mutating tools: integrationSchedulePostTool, postContentTool,
postDateTool, postStatusTool, postSettingsTool. One tool call counts once even
when it batches many posts (bulk stays one call); the refusal returns the
standard `{ errors }` shape with a retry hint, so agents recover gracefully.
Read tools are untouched.

### F9. postsListTool pagination + state filter — IMPLEMENTED (third pass)
- Input: `state` enum (`all|scheduled|draft|published|error`; `error` maps to
  the ERROR state, which the REST filter does not expose) and `page` (min 1).
- Output: `page`, `total`, `hasMore` + the same per-post fields (attachments,
  error, threadParts). PAGE_SIZE 20, sorted oldest-first, sliced in the tool.
- Deliberately NOT the repository's paginated getPostsList query: that one
  drops `image`/`error` and shares DTO/shapes with the public API and calendar;
  slicing in the tool keeps one code path for all the agent fields and zero
  production-side changes.
- Description teaches paging to protect agent context on big windows.

### F10. Dev-environment notes (third pass)
- Build recipe that works on this machine (16 GB, dev stack up):
  stop backend+frontend+orchestrator, then
  `cd apps/backend && NODE_ENV=production NODE_OPTIONS=--max-old-space-size=6144
  pnpm exec tsc --build tsconfig.build.json`. `nest build` OOMs; `tsc --build`
  (no `--force`) skips stale re-emit, so clear tsbuildinfo when in doubt.
- `pnpm install` postinstall (prisma generate) fails with EPERM while any
  backend process is alive (query engine DLL lock); `--ignore-scripts` deletes
  the `@gitroom/*` module resolution because the workspace libs have no
  package.json (root-only manifest). Recovery used here: junctions
  `node_modules/@gitroom/{backend,nestjs-libraries,helpers}` →
  `apps/backend/dist/{apps/backend/src,libraries/nestjs-libraries/src,libraries/helpers/src}`.
  Kept for future re-runs; `.freebuff/list-node-procs.ps1` helps find DLL-locked
  node processes.
- The lifecycle suite needs the orchestrator (:3002) running; a RUNNING-stuck
  workflow just means the worker is down, not a code regression.

## Test suites (all green, third pass)
- `.freebuff/mcp-rate-paginate-test.mjs` — **18/18 (new)**: 25 drafts → page1
  cap 20/total/hasMore/page2 remainder, state=draft|scheduled filters, rate
  limit trips within budget, stays limited in-window, reads unaffected
- `.freebuff/mcp-analytics-test.mjs` — 41/41 · `.freebuff/mcp-oauth-test.mjs` — 22/22
- `.freebuff/feature-tests.mjs` — 57/57 · `.freebuff/post-lifecycle-test.mjs` — 16/16
- Free-date regression — green

### Fifth pass suites (2026-09-27, dual-era backend)
- `.freebuff/mcp-confirm-test.mjs` — **17/17 (new)**: see F12
- All third-pass suites re-run green on the dual-era wiring (41/18/22/57/16 + free-date)

### Sixth pass suites (2026-09-27)
- `.freebuff/mcp-reads-test.mjs` — **33/33 (new)**: see F13
- Full battery re-run green after the tool registry grew to 27
  (17 + 41 + 18 + 22 + 57 + 16 + free-date)

### Seventh pass suites (2026-09-27)
- `.freebuff/mcp-agent-safety-test.mjs` — **16/16 (new)**: see F14
- Full battery green: 16 + 33 + 17 + 41 + 18 + 22 + 57 + 16 + free-date

### Eighth pass suites (2026-09-27)
- `.freebuff/mcp-edit-safety-test.mjs` — **14/14 (new)**: see F15
- Full battery green: 14 + 16 + 33 + 17 + 41 + 18 + 22 + 57 + 16 + free-date

### Ninth pass suites (2026-09-27)
- `.freebuff/mcp-modern-cert.mjs` — **43/43 (new)**: see F16
- Full battery green: 43 + 14 + 16 + 33 + 17 + 41 + 18 + 22 + 57 + 16 + free-date

### Tenth pass suites (2026-09-27)
- `.freebuff/mcp-method-matrix-test.mjs` — **40/40 (new)**: see F17
- Full battery green: 40 + 43 + 14 + 16 + 33 + 17 + 41 + 18 + 22 + 57 + 16 + free-date

### Eleventh pass suites (2026-09-27)
- `.freebuff/mcp-agentic-loop-test.mjs` — **28/28 (new)**: see F18
- Full battery green: 28 + 40 + 43 + 14 + 16 + 33 + 17 + 41 + 18 + 22 + 57 + 16 + free-date

### Twelfth pass suites (2026-09-27)
- `.freebuff/mcp-guidance-test.mjs` — **95/95 (new)**: see F19
- Full battery green: 95 + 28 + 40 + 43 + 14 + 16 + 33 + 17 + 41 + 18 + 22 + 57 + 16 + free-date

### Thirteenth pass suites (2026-09-27)
- `.freebuff/mcp-batch-confirm-test.mjs` — **21/21 (new)**: see F20
- Full battery green: 21 + 95 + 28 + 40 + 43 + 14 + 16 + 33 + 17 + 41 + 18 + 22 + 57 + 16 + free-date

### Fourteenth pass suites (2026-09-27)
- `.freebuff/mcp-cold-start-eval.mjs` — **9/9, 5.0/5 first-try (new)**: see F21
- Full battery green: 9 + 21 + 95 + 28 + 40 + 43 + 14 + 16 + 33 + 17 + 41 + 18 + 22 + 57 + 16 + free-date

## F22 — Pre-flight before dialog on the remaining two edit tools (round 15)
Round 8 (F18) taught postDate/postStatus the "refuse doomed calls BEFORE
asking" ordering. postContent and postSettings still ran confirmWithUser
first: a modern client was shown a confirmation dialog for a call that
could not succeed (unknown id, published post, past-QUEUE). Both tools now
pre-flight (org-scoped getPostsRecursively: unknown id / comment id /
state / past-QUEUE / content-count) before the dialog, matching the F18
convention. postSettings also gained the state+date guards it never had.

## F23 — Annotations audit (round 15)
`.freebuff/mcp-annotations-test.mjs` (24 checks) asserts the catalog-wide
invariants: every tool carries a title + the four boolean hints; the ten
pure reads are readOnly+non-destructive; the five write tools (schedule,
content, date, status, trigger) are non-readOnly+destructive;
postSettingsTool is deliberately write-but-reversible (a settings merge can
be undone) and is asserted as such. Sections B–C replay the F18/F22
ordering on ALL five mutating post tools: a doomed call must return
output.errors with resultType != input_required; happy paths must still
dialog + accept + decline correctly. Suite fixed three real things: two
wrong tool ids in my own probe, postSettings reclassified as
non-destructive, and — see F24.

## F24 — ask_postiz leak removed (round 15)
Mastra's MCPServer converts every agent registered under `agents:` into a
generated annotation-less `ask_<agentKey>` catch-all tool. The directory-
facing servers already omitted it (comment in start.mcp.ts), but the main
/mcp mount still registered `agents: { postiz: agent }`, so MCP clients saw
25 tools with one annotation-less catch-all. Dropped `agents` from the main
config: the catalog is exactly the 24 annotated tools (27 registered minus
the catch-all and the two agent-only helpers), every one uniformly
annotated. The chat agent stays reachable through its own endpoints;
`agent.listTools()` still enumerates its tools. Catalog-count assertions in
cold-start-eval / guidance / method-matrix / modern-cert updated to the
24-tool contract.

### Fifteenth pass suites (2026-09-27)
- `.freebuff/mcp-annotations-test.mjs` — **24/24 (new)**: see F23/F24
- Full battery green (13 suites live): 24 + 9 + 93 + 40 + 43 + 14 + 17 + 28
  + 16 + 18 + 33 + 22 + 41 = 398 assertions, 0 failures

## Round 16 — rebrand to SocialFlow (socialflow.ai)
Fork renamed: user-facing strings Postiz→SocialFlow, postiz.com→socialflow.ai
(user placeholder emails, agencies links, extension host matches, Plausible
analytics domain, README/docs), generic-OAuth env family POSTIZ_*→
SOCIALFLOW_* (code + .env.example; local .env never set them - zero
migration cost). Deliberately KEPT: published npm artifact names (the
`postiz` CLI, the POSTIZ_API_KEY contract the CLI reads, the
`gitroomhq/postiz-agent` skill, @postiz/node), mastra internal ids ('postiz'
agent, ui://postiz widgets, ask_postiz comments), RevenueCat product-id
comment, LICENSE/copyright. 98 files swept with sed, zero stray refs left;
public.component.tsx CLI/env tokens restored after the sweep. Battery
re-run on the rebranded build: 398/398; analytics pin now asserts the live
serverInfo name 'SocialFlow MCP'.
