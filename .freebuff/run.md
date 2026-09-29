# Run doc — Postiz dev stack (this thread's worktree)

The worktree is the main checkout itself. The Preview tab registers the
**frontend** (Next.js dev server, port 4200); it talks to the backend on :3000
and the orchestrator on :3002.

## 1. Reproduce the artifacts

1. **Env**: `.env` already lives at the repo root (main checkout). In a fresh
   worktree, copy `.env` from the main checkout — never commit it. The only
   port-relevant values are `PORT=3000` (backend), `MAIN_URL`,
   `NEXT_PUBLIC_BACKEND_URL`, `FRONTEND_URL`, and the Postgres/Redis/Temporal
   connection strings (docker-compose serves these).
2. **Services**: `docker compose -f docker-compose.dev.yaml -f
   docker-compose.dev.override.yaml up -d postiz-postgres postiz-redis temporal
   temporal-postgresql temporal-elasticsearch` (Postgres is mapped to host port
   5433 by the override).
3. **Prisma schema**: skipped when the DB already has its tables
   (`pnpm run prisma-db-push` otherwise).
4. **Dependencies**: `pnpm install --frozen-lockfile` (pnpm 10.6.1, Node 22).
   Postinstall generates the Prisma client; it fails with EPERM if a backend
   process is running (Windows locks the query-engine DLL) — stop the backend
   first. `pnpm install --ignore-scripts` instead deletes the `@gitroom/*`
   module resolution (workspace libs have no own package.json); recovery used
   in this thread: junctions
   `node_modules/@gitroom/{backend,nestjs-libraries,helpers}` →
   `apps/backend/dist/{apps/backend/src,libraries/nestjs-libraries/src,libraries/helpers/src}`.
5. **Backend build** (required before backend start; `nest build` OOMs on this
   machine with the dev stack up): stop backend/frontend/orchestrator, then
   `cd apps/backend && NODE_ENV=production
   NODE_OPTIONS=--max-old-space-size=6144 pnpm exec tsc --build
   tsconfig.build.json`. Do not pass `--force` (it OOMs); if the emit looks
   stale, delete `apps/backend/tsconfig.build.tsbuildinfo` and rebuild.

## 2. Run the servers (Windows, detached)

- **Preferred: node launcher scripts** (env from `.env`, truly detached,
  work from the tool shell without hanging): `node .freebuff/start-backend.mjs`
  (compiled build, :3000), `node .freebuff/start-orchestrator.mjs` (:3002),
  and from `apps/frontend`: `node ../../.freebuff/start-frontend.mjs`
  (`next dev -p 4200`). The launcher prints the child pid; find the listening
  pid with `netstat -ano | findstr :<port>`.
- PowerShell variants (`start-backend.ps1`, `start-orchestrator.ps1`) work when
  run interactively but **hang a non-interactive tool shell** even via
  `cmd /c start`; `kill-postiz.ps1` stops all three apps.
- **Frontend (the preview)**: `powershell -NoProfile -Command "Start-Process
  -FilePath 'cmd.exe' -ArgumentList '/c','pnpm run dev > ..\..\..\.freebuff\frontend-run.log
  2> ..\..\..\.freebuff\frontend-run.err.log' -WorkingDirectory
  'C:\Users\All in one\Downloads\postiz-app\apps\frontend' -WindowStyle Hidden"`
  — runs `next dev -p 4200` (the project's default port). Find the listening
  pid with `netstat -ano | findstr :4200`; the registered preview pid was 2808.
- Health: frontend `http://localhost:4200/auth` (200), backend
  `http://localhost:3000/` (200), orchestrator
  `http://localhost:3002/health/status` (200).
- Optional test fixture: `node .freebuff/mock-wp-server.mjs` (:4789) provides a
  fake WordPress provider used by the lifecycle e2e suite.

## 3. Notes

- The frontend alone is enough for the Preview tab, but the calendar/agent
  surfaces need the backend and orchestrator up.
- MCP surface used by the e2e suites lives at `/mcp` (bearer = org API key) and
  the OAuth mounts (`/mcp-oauth-*`) on the backend.
- Frontend fallback launcher when `pnpm run dev` fails (dotenv-cli relative
  path issue on this box): from `apps/frontend`, run node with `.env` parsed
  into `process.env` and spawn
  `node ../../node_modules/next/dist/bin/next dev -p 4200` detached (see git
  history of this file for the exact snippet). The listening pid is the child
  (e.g. 7516), not the launcher.
- MCP write rate limit is tunable via `MCP_WRITE_LIMIT` (0 disables) and
  `MCP_WRITE_WINDOW_SECONDS`. Missing provider OAuth keys now warn at backend
  startup ("is missing env keys ... connecting this channel will fail").
- **Dual-era MCP**: `MCP_PROTOCOL_MODE=auto` (default) serves legacy 2025-era
  AND modern 2026-07-28 clients on the same mounts; `MCP_CONFIRM_MODE=off`
  disables the elicitation confirmation prompts on the write tools. Both are
  documented in `.env.example`.
- **Stale tsbuildinfo trap**: `tsc -b` does NOT detect changes under
  `libraries/*` (outside the project dir) — after editing library sources,
  `find apps/backend -name "*.tsbuildinfo" -delete` before rebuilding, or the
  build exits 0 while emitting nothing. A `| tail`/`| head` pipe also masks
  the real exit code; run the build bare and check output files' mtimes.
- **Modern-era MCP client notes (2026-07-28)**: no initialize handshake
  (requests are stateless, self-describing); every message carries the
  per-request `_meta` envelope (`io.modelcontextprotocol/protocolVersion`,
  `io.modelcontextprotocol/clientCapabilities`); headers must mirror the body
  (`MCP-Protocol-Version`, and `Mcp-Method` / `Mcp-Name` for tools/call).
  See `.freebuff/mcp-confirm-test.mjs` for a working raw client.
- **Modern-era certification (round 9)**: `.freebuff/mcp-modern-cert.mjs`
  (43 checks) pins the full 2026-07-28 surface. Key contract facts:
  - `server/discover` is the handshake replacement — serves capabilities,
    `supportedVersions`, the ui-extension flag and the instructions;
    `tools/list` is the cacheable catalog (`ttlMs`/`cacheScope`, no
    instructions) and stamps `io.modelcontextprotocol/serverInfo` in result
    `_meta`.
  - Envelope is all-or-nothing: `protocolVersion` without
    `clientCapabilities` → 400 `-32602`; wrong-era string → 400 `-32022`;
    `clientCapabilities`-only or no envelope → legacy fallback.
  - Replay answers (`inputResponses`) are client-authoritative on stateless
    mounts: pre-filled answers execute without a prior round; stale keys are
    ignored (re-ask); decline/accept round-trips behave as in confirm-test.
  - JSON mounts never return `mcp-session-id`; the live tool registry is 25
    tools.
  - `MCP_CONFIRM_TIMEOUT_MS` (default 30000) bounds the elicitation wait in
    `confirm.elicit.ts`; timeout fails open (never hangs the write tool).
- **Method-surface matrix (round 10)**: `.freebuff/mcp-method-matrix-test.mjs`
  (40 checks). The modern mounts serve exactly `server/discover`,
  `tools/list`, `tools/call`, `resources/list`, `resources/read`; every other
  method → fast 404 `-32601`. Header/body mirroring: envelope requires the
  `mcp-method` header (`-32020` otherwise); name-bearing params must mirror
  into `mcp-name` (`tools/call` → `params.name`, `resources/read` →
  `params.uri`). The ui widget (`ui://postiz/upload`) is a full MCP App:
  `text/html;profile=mcp-app`, csp pinned to the backend origin,
  clipboardWrite permission, prefersBorder. Unknown tools answer
  `isError:true` + text at the protocol layer (Mastra), distinct from the
  tool-level `output.errors` contract.
- **Agentic-loop simulation (round 11)**: `.freebuff/mcp-agentic-loop-test.mjs`
  (28 checks) plays the full agent journey with friction metrics — 22 calls,
  22.5 KB (~5.8K tokens), 380 ms wall, zero protocol errors. Pre-flight
  ordering rule now pinned: ALL schedule refusals (date, channel,
  validation) fire BEFORE the confirmation dialog on BOTH eras — an agent
  mistake must never pop a confirm dialog. postDetails unknown-id carries a
  postsList recovery hint.
- **Guidance audit (round 12)**: `.freebuff/mcp-guidance-test.mjs` (95
  checks) pins the catalog as the agent's documentation: no empty arg
  descriptions, next-hop chain intact (schema→triggerTool,
  freeDateTime→date, mediaList→attachments), and the schedule tool teaches
  the shapes agents fumble first try ([] settings for drafts, UTC date
  format, first=post/rest=comments). When touching any tool's inputSchema,
  run this suite — a schema change can silently drop a describe().
- **Batch confirmations (round 13)**: `.freebuff/mcp-batch-confirm-test.mjs`
  (21 checks). Multi-post writes (2–25) confirm through ONE per-post
  checkbox form; partial accepts return `{ errors, created, declined[] }`
  where declined carries the unchecked socialPost indices (the agent can
  retry just those). >25 posts fall back to the simple dialog. All
  fail-open rules and the timeout valve are shared with the single dialog.
- **Annotations audit (round 15)**:
  `.freebuff/mcp-annotations-test.mjs` (24 checks) — run after ANY change to
  a tool's annotations block, any change to the mutating-tool pre-flights,
  or any change to the MCPServer config in start.mcp.ts. Invariants: 24
  tools, every one title+4-hints annotated, no generated ask_<agent>
  catch-all (F24), reads readOnly, writes destructive, postSettings
  deliberately reversible; sections B–C re-verify the F18/F22 "refuse
  doomed calls BEFORE the dialog" ordering on all five mutating post tools
  (raw resultType must NOT be input_required on a doomed call).
- **Failure-journey eval (round 17)**:
  `.freebuff/mcp-failure-journeys-test.mjs` (14 checks, score 8.0/8) — run
  after ANY change to error messages, state guards, or the disabled-channel
  handling. Journeys that must fail cleanly (published-post edits,
  disabled-channel discovery/writes, bogus trigger methodName) score the
  refusal an agent sees: 1.0 actionable (names the state/blocker or the
  alternative tool), 0.5 vague, 0 crash/dialog-for-doomed/silent-success.
  The safe-cleanup cancel of a dead-channel post must still SUCCEED after
  its confirmation — never block cleanup.
- **Hints deep audit + decline telemetry (round 18)**:
  `.freebuff/mcp-hints-deep-test.mjs` (12 checks) — run after ANY change
  to the non-post tools' annotations, the media/upload services, or the
  decline handling in confirm.elicit.ts. Pins the audited hints table for
  the 10 always-cataloged non-post tools (note: `generateVideoOptions`
  has no Tool suffix), asserts clipping tools are absent when clipping is
  disabled, and proves idempotency hints LIVE (double upload = two rows;
  double status poll = identical bodies). Telemetry contract: the 3rd
  decline of the SAME action (org + normalized message, 10-min TTL)
  carries the "do not keep retrying" guidance; acceptance after declines
  still works; different actions start fresh.
- **Kill-switch verification (round 19)**:
  `.freebuff/mcp-kill-switch-test.mjs` is mode-aware (PROBE_MODE env) and
  must be run against THREE separate backend starts: baseline (no env),
  `MCP_CONFIRM_MODE=off node .freebuff/start-backend.mjs`, and
  `MCP_PROTOCOL_MODE=legacy node .freebuff/start-backend.mjs` — each with
  its matching PROBE_MODE (the launcher passes exported env through).
  Contract: input_required ONLY on baseline; under either switch modern
  writes EXECUTE immediately; pre-flights and the legacy-session path
  hold everywhere. If legacy mode ever regresses to dying with "Cannot
  request input 'mastra_elicit_0'", see F30: the gate must mirror the
  dispatch switch (PROTOCOL_LEGACY check in confirm.elicit.ts).
- **Cold-start agent eval (round 14)**:
  `.freebuff/mcp-cold-start-eval.mjs` (9 checks, score 5.0/5) plays a
  catalog-only agent through the schedule journey on a fresh org and scores
  first-try argument validity. Run it after ANY change to tool descriptions
  or input schemas — a zod failure here means the docs no longer teach the
  shape. Note: a modern write's first valid attempt returns input_required;
  score against the RAW result before unwrapping.
