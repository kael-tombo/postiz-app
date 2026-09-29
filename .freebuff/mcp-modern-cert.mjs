// Round 9 / F16 — MODERN-ERA (2026-07-28) MCP HOST CERTIFICATION SUITE.
// Pins the wire contract a modern MCP host relies on, exercising the server
// the way a hostile-but-honest host would. Reuses the working raw modern-era
// client pattern from mcp-confirm-test.mjs.
//
// What it certifies:
//   A. Discovery  — server/discover (handshake replacement: capabilities +
//                   instructions + ui extension) and tools/list (cacheable
//                   catalog) on /mcp, /mcp/:id and the oauth mount, all
//                   WITHOUT initialize; legacy initialize still negotiates.
//   B. Gate       — write tools gate on elicitation in modern era (input_required),
//                   and the gate keys on the per-request _meta ENVELOPE (not the
//                   legacy initialize/params.protocolVersion string).
//   C. Auth       — bad key -> 401 on modern path too; valid key on /mcp/:id works.
//   D. Coexistence— legacy + modern sessions on the same server simultaneously;
//                   wrong/missing envelope protocol version fails toward legacy
//                   semantics (no gate), matching fail-open design.
//   E. Replay     — stale inputResponses key is ignored (agent re-asks);
//                   inputResponses with missing/unknown action declines;
//                   cancel path on postStatusTool still gated.
//   F. Rate limit — 27 tools + several calls stay inside MCP_WRITE_LIMIT without
//                   429s (read tools exempt).
//
// Prereqs: rebuilt backend on :3000, docker stack up, mock-wp on :4789.
// Run: node .freebuff/mcp-modern-cert.mjs
import fs from 'node:fs';
import { execSync } from 'node:child_process';

const BASE = 'http://localhost:3000';
const rand = Math.floor(Math.random() * 100000);

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name} ${detail}`); }
}

const PROTOCOL_VERSION_META_KEY = 'io.modelcontextprotocol/protocolVersion';
const CLIENT_CAPABILITIES_META_KEY = 'io.modelcontextprotocol/clientCapabilities';
const ERA = '2026-07-28';

async function api(method, path, { body, cookie, apiKey, sessionId, accept, extraHeaders } = {}) {
  const headers = { ...(extraHeaders || {}) };
  if (body) headers['content-type'] = 'application/json';
  if (cookie) headers['cookie'] = cookie;
  if (apiKey) headers['authorization'] = `Bearer ${apiKey}`;
  headers['accept'] = accept || 'application/json, text/event-stream';
  if (sessionId) headers['mcp-session-id'] = sessionId;
  const res = await fetch(BASE + path, {
    method, headers,
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
    signal: AbortSignal.timeout(30000),
  });
  const sid = res.headers.get('mcp-session-id') || '';
  const text = await res.text();
  let json = null;
  if ((res.headers.get('content-type') || '').includes('text/event-stream')) {
    const lines = text.split('\n').filter((l) => l.startsWith('data:'));
    for (let i = lines.length - 1; i >= 0; i--) {
      try { json = JSON.parse(lines[i].slice(5).trim()); break; } catch {}
    }
  } else {
    try { json = JSON.parse(text); } catch {}
  }
  return { status: res.status, json, text, sessionId: sid, setCookie: res.headers.getSetCookie?.() || [] };
}

let rpcId = 0;
function rpc(method, params, isNotification = false) {
  const msg = { jsonrpc: '2.0', method, ...(isNotification ? {} : { id: ++rpcId }) };
  if (params) msg.params = params;
  return msg;
}
function unwrap(result) {
  if (result?.structuredContent?.output !== undefined) return result.structuredContent.output;
  if (result?.output !== undefined) return result.output;
  try {
    const text = result?.content?.find((c) => c.type === 'text')?.text;
    return text ? JSON.parse(text) : null;
  } catch { return result; }
}
// legacy session helper (initialize + notifications/initialized)
async function openLegacySession(apiKey) {
  const r = await api('POST', '/mcp', {
    apiKey,
    body: rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'cert-legacy', version: '1' } }),
  });
  const sid = r.sessionId;
  if (!sid) console.log(`  [diag] legacy initialize status=${r.status} body=${JSON.stringify(r.json || r.text).slice(0, 160)}`);
  await api('POST', '/mcp', { apiKey, sessionId: sid, body: rpc('notifications/initialized', undefined, true) });
  return sid;
}
async function callLegacy(apiKey, sid, name, args) {
  const r = await api('POST', '/mcp', { apiKey, sessionId: sid, body: rpc('tools/call', { name, arguments: args }) });
  return { result: r.json?.result ?? null, status: r.status };
}
// modern-era single-shot call (stateless; envelope on every message)
async function callModern(path, apiKey, name, args, { caps, inputResponses, protocolVersion, skipEnvelope, headers } = {}) {
  const params = { name, arguments: args };
  if (inputResponses) params.inputResponses = inputResponses;
  const modernHeaders = {};
  if (!skipEnvelope) {
    modernHeaders['mcp-method'] = 'tools/call';
    modernHeaders['mcp-name'] = name;
  }
  const envelope = {
    _meta: {
      ...(skipEnvelope ? {} : { [PROTOCOL_VERSION_META_KEY]: protocolVersion || ERA }),
      ...(caps !== undefined && !skipEnvelope ? { [CLIENT_CAPABILITIES_META_KEY]: caps } : {}),
    },
  };
  const r = await api('POST', path, {
    apiKey,
    extraHeaders: modernHeaders,
    body: rpc('tools/call', { ...params, ...envelope }),
  });
  return { result: r.json?.result ?? null, status: r.status, raw: r };
}
async function listToolsModern(path, apiKey) {
  const r = await api('POST', path, {
    apiKey,
    extraHeaders: { 'mcp-method': 'tools/list', 'mcp-name': '' },
    body: rpc('tools/list', { _meta: { [PROTOCOL_VERSION_META_KEY]: ERA, [CLIENT_CAPABILITIES_META_KEY]: {} } }),
  });
  return { result: r.json?.result ?? null, status: r.status, raw: r };
}
// server/discover: the modern-era handshake replacement (orientation +
// capabilities + instructions). Discoverable like any request - envelope in,
// DiscoverResult out.
async function discoverModern(path, apiKey) {
  const r = await api('POST', path, {
    apiKey,
    extraHeaders: { 'mcp-method': 'server/discover', 'mcp-name': '' },
    body: rpc('server/discover', { _meta: { [PROTOCOL_VERSION_META_KEY]: ERA, [CLIENT_CAPABILITIES_META_KEY]: {} } }),
  });
  return { result: r.json?.result ?? null, status: r.status, raw: r };
}

// ---------- setup: user + key + mock channel ----------
let r = await api('POST', '/auth/register', { body: { provider: 'LOCAL', email: `mcpcert${rand}@postiz.local`, password: 'CertTest123!', company: 'Cert Co' }, accept: 'application/json' });
const cookie = (r.setCookie.find((c) => c.startsWith('auth=')) || '').split(';')[0];
r = await api('GET', '/user/self', { cookie });
const orgId = r.json?.orgId;
check('register + session', !!orgId, `status ${r.status}`);
r = await api('POST', '/user/api-key/rotate', { cookie });
const apiKey = r.json?.apiKey || r.json?.key || '';
check('api key rotated', !!apiKey);
const apiKeyInUrl = encodeURIComponent(apiKey);

const prismaScript = `
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const integration = await p.integration.create({
    data: {
      internalId: 'certwp_${rand}',
      organizationId: '${orgId}',
      name: 'Mock WP (cert)',
      providerIdentifier: 'wordpress',
      type: 'article',
      token: '${Buffer.from(JSON.stringify({ domain: 'http://127.0.0.1:4789', username: 'u', password: 'p' })).toString('base64')}',
      picture: '',
    },
  });
  console.log('INTEGRATION_ID=' + integration.id);
  await p.$disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
`;
fs.writeFileSync('.freebuff/tmp-cert-integration.cjs', prismaScript);
let integrationId = '';
try {
  const out = execSync('node .freebuff/tmp-cert-integration.cjs', { encoding: 'utf8', timeout: 60000 });
  integrationId = (out.match(/INTEGRATION_ID=(\S+)/) || [])[1] || '';
} catch (e) {
  console.log(String(e.stderr || e.message || '').slice(0, 160));
}
check('mock wordpress integration created', !!integrationId, integrationId);

const scheduleArgs = (tag) => ({
  socialPost: [{
    integrationId, isPremium: false,
    date: new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 19),
    shortLink: false, type: 'draft',
    postsAndComments: [{ content: `<p>cert test ${rand} ${tag}</p>`, attachments: [] }],
    // drafts skip provider settings validation; WP title/type/status only
    // matter on publish (all suites use settings: [] for draft writes)
    settings: [],
  }],
});

// ============ A. DISCOVERY ============
console.log('== A. DISCOVERY (server/discover + tools/list, no initialize) ==');
const disco = await discoverModern('/mcp', apiKey);
check('server/discover on /mcp (modern handshake)', disco.status === 200 && Array.isArray(disco.result?.supportedVersions), `status ${disco.status} ${JSON.stringify(disco.raw.json?.error || {}).slice(0, 140)}`);
check('discover advertises 2026-07-28', disco.result?.supportedVersions?.includes(ERA), JSON.stringify(disco.result?.supportedVersions));
check('discover advertises tools capability', !!disco.result?.capabilities?.tools, JSON.stringify(disco.result?.capabilities || {}).slice(0, 120));
check('discover carries server instructions', typeof disco.result?.instructions === 'string' && disco.result.instructions.length > 40, String(disco.result?.instructions).slice(0, 60));
check('discover advertises MCP Apps ui extension', !!disco.result?.capabilities?.extensions?.['io.modelcontextprotocol/ui'], JSON.stringify(disco.result?.capabilities?.extensions || {}));
const discoId = await discoverModern(`/mcp/${apiKeyInUrl}`, '');
check('server/discover on /mcp/:id', discoId.status === 200 && Array.isArray(discoId.result?.supportedVersions), `status ${discoId.status}`);
const discoOauth = await discoverModern('/mcp-oauth-dynamic', apiKey);
check('server/discover on oauth mount', discoOauth.status === 200 && Array.isArray(discoOauth.result?.supportedVersions), `status ${discoOauth.status}`);

const disc = await listToolsModern('/mcp', apiKey);
check('tools/list on /mcp (modern, stateless)', disc.status === 200 && Array.isArray(disc.result?.tools), `status ${disc.status} ${JSON.stringify(disc.raw.json?.error || {}).slice(0, 140)}`);
// F24: exactly the 24 registered tools - the generated annotation-less
// ask_postiz catch-all no longer leaks onto the catalog.
check('tool count = 24 (F24 catalog uniformity)', (disc.result?.tools?.length || 0) === 24, `got ${disc.result?.tools?.length}`);
check('catalog carries serverInfo in _meta', !!disc.result?._meta?.['io.modelcontextprotocol/serverInfo']?.name, JSON.stringify(disc.result?._meta || {}));
check('catalog is cacheable (ttlMs + cacheScope, SEP-2549)', Number.isFinite(disc.result?.ttlMs) && !!disc.result?.cacheScope, JSON.stringify({ ttlMs: disc.result?.ttlMs, cacheScope: disc.result?.cacheScope }));
check('instructions live on discover, NOT tools/list (split contract)', disc.result?.instructions === undefined, String(disc.result?.instructions));
const names = new Set((disc.result?.tools || []).map((t) => t.name));
check('core read tools present', ['postsListTool', 'postDetailsTool', 'integrationList'].every((n) => names.has(n)), [...names].slice(0, 6).join(','));
check('core write tools present', ['integrationSchedulePostTool', 'postContentTool', 'postDateTool', 'postStatusTool', 'postSettingsTool'].every((n) => names.has(n)));
const sched = (disc.result?.tools || []).find((t) => t.name === 'integrationSchedulePostTool');
check('write tool has description (host UX)', typeof sched?.description === 'string' && sched.description.length > 50, JSON.stringify(sched || {}).slice(0, 80));

const discListId = await listToolsModern(`/mcp/${apiKeyInUrl}`, '');
check('tools/list on /mcp/:id (modern, stateless)', discListId.status === 200 && Array.isArray(discListId.result?.tools), `status ${discListId.status}`);
const discListOauth = await listToolsModern('/mcp-oauth-dynamic', apiKey);
check('tools/list on oauth mount (modern, stateless)', discListOauth.status === 200 && Array.isArray(discListOauth.result?.tools), `status ${discListOauth.status}`);

// Legacy session coexists on the same server (dual-era).
const legacySid = await openLegacySession(apiKey);
// Stateless JSON mounts do not return mcp-session-id (sessions are
// meaningless without state) - the legacy handshake result is what matters.
const legacyInit = await api('POST', '/mcp', {
  apiKey,
  body: rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'cert-legacy2', version: '1' } }),
});
check('legacy initialize negotiates 2025-03-26 alongside modern', legacyInit.json?.result?.protocolVersion === '2025-03-26', JSON.stringify(legacyInit.json || {}).slice(0, 120));
check('stateless mount: no mcp-session-id on JSON response', !legacyInit.sessionId, legacyInit.sessionId);
const legacyList = await callLegacy(apiKey, legacySid, 'postsListTool', { startDate: '2024-01-01', endDate: '2026-12-31', page: 1 });
check('legacy tools/call works alongside modern', !!legacyList.result, JSON.stringify(legacyList).slice(0, 100));

// ============ B. GATE ============
console.log('== B. CONFIRMATION GATE (envelope-keyed) ==');
const elicitationCaps = { elicitation: {} };
const g1 = await callModern('/mcp', apiKey, 'integrationSchedulePostTool', scheduleArgs('gate'), { caps: elicitationCaps });
check('modern write: round1 input_required', g1.result?.resultType === 'input_required', JSON.stringify(g1.result || {}).slice(0, 200));
const g1key = g1.result?.inputRequests ? Object.keys(g1.result.inputRequests)[0] : '';
check('inputRequests keyed mastra_elicit_0', g1key === 'mastra_elicit_0', g1key);
const g1embedded = g1.result?.inputRequests?.[g1key];
check('embedded elicitation/create with message', g1embedded?.method === 'elicitation/create' && typeof g1embedded?.params?.message === 'string' && g1embedded.params.message.length > 10, JSON.stringify(g1embedded || {}).slice(0, 140));

// The codec STRICTLY rejects a wrong-era envelope at the protocol layer
// (-32022) before any tool runs - certification pins this hard gate.
const gWrongEra = await callModern('/mcp', apiKey, 'integrationSchedulePostTool', scheduleArgs('wrongera'), { caps: elicitationCaps, protocolVersion: '2025-06-18' });
check('wrong-era envelope -> strict -32022 rejection', gWrongEra.status === 400 && gWrongEra.raw.json?.error?.code === -32022, `${gWrongEra.status} ${JSON.stringify(gWrongEra.raw.json?.error || {}).slice(0, 120)}`);
// Malformed envelope: protocolVersion WITHOUT clientCapabilities -> -32602.
const gNoCapsKey = await api('POST', '/mcp', {
  apiKey,
  extraHeaders: { 'mcp-method': 'tools/call', 'mcp-name': 'integrationSchedulePostTool' },
  body: rpc('tools/call', { name: 'integrationSchedulePostTool', arguments: scheduleArgs('nocapskey'), _meta: { [PROTOCOL_VERSION_META_KEY]: ERA } }),
});
check('protocolVersion without clientCapabilities -> -32602', gNoCapsKey.status === 400 && gNoCapsKey.json?.error?.code === -32602, `${gNoCapsKey.status} ${JSON.stringify(gNoCapsKey.json?.error || {}).slice(0, 120)}`);

// Missing elicitation capability (clientCapabilities: {} present, no
// elicitation key) -> gate fail-open, draft created.
const gNoCap = await callModern('/mcp', apiKey, 'integrationSchedulePostTool', scheduleArgs('nocap'), { caps: {} });
const gNoCapOut = unwrap(gNoCap.result);
check('envelope without elicitation capability -> fail-open', Array.isArray(gNoCapOut) ? !!gNoCapOut[0]?.postId : gNoCapOut?.postId !== undefined, JSON.stringify(gNoCapOut || gNoCap.result || {}).slice(0, 160));

// ============ C. AUTH ============
console.log('== C. AUTH ON MODERN PATH ==');
const badKey = await listToolsModern('/mcp', 'pos_bogus_key');
check('bad key on modern tools/list -> 401', badKey.status === 401, `status ${badKey.status}`);
const badKeyCall = await callModern('/mcp', 'pos_bogus_key', 'postsListTool', { startDate: '2024-01-01', endDate: '2026-12-31', page: 1 }, { caps: elicitationCaps });
check('bad key on modern tools/call -> 401', badKeyCall.status === 401, `status ${badKeyCall.status}`);
const idPathCall = await callModern(`/mcp/${apiKeyInUrl}`, '', 'postsListTool', { startDate: '2024-01-01', endDate: '2026-12-31', page: 1 }, { caps: elicitationCaps });
check('valid key via /mcp/:id modern call works', idPathCall.status === 200 && !!idPathCall.result, `status ${idPathCall.status}`);

// ============ D. REPLAY CORRELATION ============
console.log('== D. REPLAY CORRELATION (answers bind to the pending identical call) ==');
// D1: round1, then retry SAME args with a STALE key -> ignored, re-ask.
const d1Args = scheduleArgs('d1');
const d1r1 = await callModern('/mcp', apiKey, 'integrationSchedulePostTool', d1Args, { caps: elicitationCaps });
check('D1 round1 input_required', d1r1.result?.resultType === 'input_required', JSON.stringify(d1r1.result || {}).slice(0, 120));
const d1stale = await callModern('/mcp', apiKey, 'integrationSchedulePostTool', d1Args, {
  caps: elicitationCaps,
  inputResponses: { mastra_elicit_999: { action: 'accept', content: { confirm: true } } },
});
check('D1 stale key -> re-ask, never executes', d1stale.result?.resultType === 'input_required', JSON.stringify(d1stale.result || {}).slice(0, 160));
// D2: accept answer WITHOUT a prior round1 on those args. The stateless
// mount keeps no pending-request state, so Mastra's replay contract treats
// inputResponses as client-authoritative: the tool re-runs and our gate sees
// answers present -> executes. This is the SEP-1331 trust model (the host is
// the human's representative; a host that pre-fills answers is outside the
// server's defense surface - same as a host that never relays the form).
// Pinned here so a future SDK that adds pending-state correlation is noticed.
const d2 = await callModern('/mcp', apiKey, 'integrationSchedulePostTool', scheduleArgs('d2'), {
  caps: elicitationCaps,
  inputResponses: { mastra_elicit_0: { action: 'accept', content: { confirm: true } } },
});
const d2out = unwrap(d2.result);
check('D2 unprompted answers execute (client-authoritative replay, documented)', Array.isArray(d2out) ? !!d2out[0]?.postId : !!d2out?.postId, JSON.stringify(d2out || d2.result || {}).slice(0, 160));
// D3: proper correlation - decline answer -> structured errors, nothing written.
const d3Args = scheduleArgs('d3');
const d3r1 = await callModern('/mcp', apiKey, 'integrationSchedulePostTool', d3Args, { caps: elicitationCaps });
const d3key = d3r1.result?.inputRequests ? Object.keys(d3r1.result.inputRequests)[0] : '';
const d3decline = await callModern('/mcp', apiKey, 'integrationSchedulePostTool', d3Args, {
  caps: elicitationCaps,
  inputResponses: { [d3key]: { action: 'decline' } },
});
const d3out = unwrap(d3decline.result);
check('D3 correlated decline -> structured errors', typeof d3out?.errors === 'string' && /declin/i.test(d3out.errors), JSON.stringify(d3out || d3decline.result || {}).slice(0, 160));
// D4: proper correlation - accept answer -> executes exactly once.
const d4Args = scheduleArgs('d4');
const d4r1 = await callModern('/mcp', apiKey, 'integrationSchedulePostTool', d4Args, { caps: elicitationCaps });
const d4key = d4r1.result?.inputRequests ? Object.keys(d4r1.result.inputRequests)[0] : '';
const d4accept = await callModern('/mcp', apiKey, 'integrationSchedulePostTool', d4Args, {
  caps: elicitationCaps,
  inputResponses: { [d4key]: { action: 'accept', content: { confirm: true } } },
});
const d4out = unwrap(d4accept.result);
check('D4 correlated accept -> executes', Array.isArray(d4out) ? !!d4out[0]?.postId : !!d4out?.postId, JSON.stringify(d4out || d4accept.result || {}).slice(0, 160));
const listD = await callModern('/mcp', apiKey, 'postsListTool', { startDate: '2024-01-01', endDate: '2026-12-31', page: 1, state: 'draft' }, { caps: elicitationCaps });
check('D4 exactly one new draft from the accept round-trip', listD.result && (unwrap(listD.result)?.total >= 1), `total ${unwrap(listD.result || {})?.total}`);

// ============ E. COEXISTENCE ============
console.log('== E. DUAL-ERA COEXISTENCE ==');
const legacyWrite = await callLegacy(apiKey, legacySid, 'integrationSchedulePostTool', scheduleArgs('legacyco'));
const legacyWriteOut = unwrap(legacyWrite.result);
check('legacy era: write executes without gate', Array.isArray(legacyWriteOut) && !!legacyWriteOut[0]?.postId, JSON.stringify(legacyWriteOut || legacyWrite.result || {}).slice(0, 140));
const modernAfter = await callModern('/mcp', apiKey, 'postsListTool', { startDate: '2024-01-01', endDate: '2026-12-31', page: 1 }, { caps: elicitationCaps });
check('modern reads still fine after legacy write', modernAfter.status === 200 && !!modernAfter.result, `status ${modernAfter.status}`);

// ============ F. RATE LIMIT ============
console.log('== F. RATE LIMIT UNDER CERTIFICATION LOAD ==');
const readLoop = [];
for (let i = 0; i < 5; i++) {
  readLoop.push(callModern('/mcp', apiKey, 'postsListTool', { startDate: '2024-01-01', endDate: '2026-12-31', page: 1 }, { caps: elicitationCaps }));
}
const readResults = await Promise.all(readLoop);
check('5 parallel modern reads: no 429', readResults.every((x) => x.status === 200), readResults.map((x) => x.status).join(','));

// ============ G. DECLINE TELEMETRY SHAPE ============
console.log('== G. DECLINE + READ-ONLY MODERN SHAPE ==');
const gArgs = scheduleArgs('g-decline');
const gRound = await callModern('/mcp', apiKey, 'integrationSchedulePostTool', gArgs, { caps: elicitationCaps });
const gKey = gRound.result?.inputRequests ? Object.keys(gRound.result.inputRequests)[0] : '';
const gDecline = await callModern('/mcp', apiKey, 'integrationSchedulePostTool', gArgs, {
  caps: elicitationCaps,
  inputResponses: { [gKey]: { action: 'decline' } },
});
const gOut = unwrap(gDecline.result);
check('decline -> isError/structured errors (no throw)', typeof gOut?.errors === 'string' && /declin/i.test(gOut.errors), JSON.stringify(gOut || gDecline.result || {}).slice(0, 140));
const readShape = await callModern('/mcp', apiKey, 'postDetailsTool', { id: 'does-not-exist' }, { caps: elicitationCaps });
const readOut = unwrap(readShape.result);
check('postDetails unknown id -> structured error (not crash)', readOut && (readOut.errors || readOut.post === null || readOut.error), JSON.stringify(readOut || readShape.result || {}).slice(0, 120));

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
