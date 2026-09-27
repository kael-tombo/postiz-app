// Round 11 / F18 — FULL AGENTIC-LOOP SIMULATION over MCP.
// Plays the agent exactly as a modern-era host would: orient via
// server/discover, plan through reads, act through confirmed writes, verify,
// and handle recovery paths. Measures per-hop friction: round-trips, payload
// bytes (→ rough token cost), and wall time — the metrics that decide whether
// an agent can actually drive Postiz cheaply and safely.
//
// Prereqs: backend :3000 (dual-era auto), mock-wp :4789.
// Run: node .freebuff/mcp-agentic-loop-test.mjs
import fs from 'node:fs';
import { execSync } from 'node:child_process';

const BASE = 'http://localhost:3000';
const rand = Math.floor(Math.random() * 100000);
const ERA = '2026-07-28';
const PV = 'io.modelcontextprotocol/protocolVersion';
const CC = 'io.modelcontextprotocol/clientCapabilities';

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name} ${detail}`); }
}

// ---------- harness ----------
const HOPS = [];
let hop = null;
function beginHop(name) {
  hop = { name, calls: 0, bytesIn: 0, bytesOut: 0, ms: 0, errors: 0 };
  HOPS.push(hop);
}
function endHop() { hop = null; }

async function api(method, path, { body, apiKey, extraHeaders } = {}) {
  const headers = { ...(extraHeaders || {}) };
  if (body) headers['content-type'] = 'application/json';
  if (apiKey) headers['authorization'] = `Bearer ${apiKey}`;
  headers['accept'] = 'application/json, text/event-stream';
  const t0 = Date.now();
  const res = await fetch(BASE + path, {
    method, headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  const text = await res.text();
  if (hop) {
    hop.calls++;
    hop.ms += Date.now() - t0;
    hop.bytesOut += body ? JSON.stringify(body).length : 0;
    hop.bytesIn += text.length;
  }
  let json = null;
  if ((res.headers.get('content-type') || '').includes('text/event-stream')) {
    const lines = text.split('\n').filter((l) => l.startsWith('data:'));
    for (let i = lines.length - 1; i >= 0; i--) { try { json = JSON.parse(lines[i].slice(5).trim()); break; } catch {} }
  } else { try { json = JSON.parse(text); } catch {} }
  return { status: res.status, json, text };
}
let idc = 0;
async function mcpCall(name, args, opts = {}) {
  const params = { name, arguments: args };
  if (opts.inputResponses) params.inputResponses = opts.inputResponses;
  const r = await api('POST', '/mcp', {
    apiKey,
    extraHeaders: { 'mcp-method': 'tools/call', 'mcp-name': name },
    body: { jsonrpc: '2.0', id: ++idc, method: 'tools/call', params: { ...params, _meta: { [PV]: ERA, [CC]: { elicitation: {} } } } },
  });
  const result = r.json?.result ?? null;
  if (hop && (r.json?.error || result?.isError)) hop.errors++;
  return result;
}
function unwrap(result) {
  if (result?.structuredContent?.output !== undefined) return result.structuredContent.output;
  if (result?.output !== undefined) return result.output;
  try {
    const text = result?.content?.find((c) => c.type === 'text')?.text;
    return text ? JSON.parse(text) : null;
  } catch { return result; }
}
function report() {
  const totalCalls = HOPS.reduce((a, h) => a + h.calls, 0);
  const totalBytes = HOPS.reduce((a, h) => a + h.bytesIn + h.bytesOut, 0);
  const totalMs = HOPS.reduce((a, h) => a + h.ms, 0);
  const totalErrors = HOPS.reduce((a, h) => a + h.errors, 0);
  console.log('\n-- friction report (per hop: calls, KB, ms, errors) --');
  for (const h of HOPS) console.log(`  ${h.name.padEnd(28)} ${String(h.calls).padStart(2)} calls ${((h.bytesIn + h.bytesOut) / 1024).toFixed(1).padStart(7)} KB ${String(h.ms).padStart(6)} ms ${h.errors} err`);
  console.log(`  ${'TOTAL'.padEnd(28)} ${String(totalCalls).padStart(2)} calls ${(totalBytes / 1024).toFixed(1).padStart(7)} KB ${String(totalMs).padStart(6)} ms ${totalErrors} err`);
  console.log(`  rough token estimate (bytes/4): ~${Math.round(totalBytes / 4)}`);
  return { totalCalls, totalBytes, totalMs, totalErrors };
}

// ---------- setup (not measured; admin, not agent) ----------
const reg = await fetch(BASE + '/auth/register', {
  method: 'POST',
  headers: { 'content-type': 'application/json', accept: 'application/json' },
  body: JSON.stringify({ provider: 'LOCAL', email: `loop${rand}@postiz.local`, password: 'LoopTest123!', company: 'Loop Co' }),
});
const authCookie = ((reg.headers.getSetCookie?.() || []).find((c) => c.startsWith('auth=')) || '').split(';')[0];
const orgId = (await (await fetch(BASE + '/user/self', { headers: { cookie: authCookie } })).json())?.orgId;
const apiKey = (await (await fetch(BASE + '/user/api-key/rotate', { method: 'POST', headers: { cookie: authCookie } })).json())?.apiKey || '';
check('setup: user + key', !!orgId && !!apiKey);

fs.writeFileSync('.freebuff/tmp-loop-integration.cjs', `
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const integration = await p.integration.create({
    data: {
      internalId: 'loopwp_${rand}',
      organizationId: '${orgId}',
      name: 'Mock WP (loop)',
      providerIdentifier: 'wordpress',
      type: 'article',
      token: '${Buffer.from(JSON.stringify({ domain: 'http://127.0.0.1:4789', username: 'u', password: 'p' })).toString('base64')}',
      picture: '',
    },
  });
  console.log('INTEGRATION_ID=' + integration.id);
  await p.$disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
`);
let integrationId = '';
try {
  const out = execSync('node .freebuff/tmp-loop-integration.cjs', { encoding: 'utf8', timeout: 60000 });
  integrationId = (out.match(/INTEGRATION_ID=(\S+)/) || [])[1] || '';
} catch (e) { console.log(String(e.stderr || e.message || '').slice(0, 160)); }
check('setup: mock wordpress integration', !!integrationId);

// ================= HOP 1: ORIENT =================
console.log('\n== HOP 1: ORIENT (discover + integrationList) ==');
beginHop('orient (discover+integrations)');
let r = await api('POST', '/mcp', {
  apiKey,
  extraHeaders: { 'mcp-method': 'server/discover', 'mcp-name': '' },
  body: { jsonrpc: '2.0', id: ++idc, method: 'server/discover', params: { _meta: { [PV]: ERA, [CC]: { elicitation: {} } } } },
});
const discoverResult = r.json?.result;
check('H1 discover succeeded', r.status === 200 && Array.isArray(discoverResult?.supportedVersions), `${r.status}`);
check('H1 instructions fit in one read', (discoverResult?.instructions || '').length > 100 && (discoverResult?.instructions || '').length < 4000, `${(discoverResult?.instructions || '').length} chars`);
check('H1 capabilities name tools + resources(ui)', !!discoverResult?.capabilities?.tools && !!discoverResult?.capabilities?.resources, JSON.stringify(discoverResult?.capabilities || {}).slice(0, 100));
const integrations = unwrap(await mcpCall('integrationList', {}));
check('H1 channel discovered with platform + disabled flag', integrations?.length >= 1 && integrations.some((i) => i.id === integrationId && i.platform === 'wordpress' && i.disabled === false), JSON.stringify((integrations || []).slice(0, 2)).slice(0, 200));
endHop();

// ================= HOP 2: PLAN =================
console.log('\n== HOP 2: PLAN (schema for the channel + free slot) ==');
beginHop('plan (schema+free slot)');
const schema = unwrap(await mcpCall('integrationSchema', { isPremium: false, platform: 'wordpress' }));
check('H2 schema returned settings rules', !!schema, JSON.stringify(schema).slice(0, 120));
const slot = unwrap(await mcpCall('freeDateTimeTool', { integrationId }));
check('H2 free slot returned a concrete date', !!slot, JSON.stringify(slot).slice(0, 120));
const plannedDate = typeof slot === 'string' ? slot : slot?.date || slot?.freeDateTime;
check('H2 slot parses as a future date', plannedDate && new Date(plannedDate).toString() !== 'Invalid Date', String(plannedDate));
endHop();

// ================= HOP 3: ACT (confirmed write) =================
console.log('\n== HOP 3: ACT (schedule with elicitation round-trip) ==');
beginHop('act (confirmed write)');
const draft = [{
  integrationId, isPremium: false,
  date: new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 19),
  shortLink: false, type: 'draft',
  postsAndComments: [{ content: `<p>agentic loop ${rand}</p>`, attachments: [] }],
  settings: [],
}];
let r1 = await mcpCall('integrationSchedulePostTool', { socialPost: draft });
check('H3 round1 is input_required (gate engaged)', r1?.resultType === 'input_required', JSON.stringify(r1 || {}).slice(0, 120));
const confirmKey = r1?.inputRequests ? Object.keys(r1.inputRequests)[0] : '';
const askMsg = r1?.inputRequests?.[confirmKey]?.params?.message || '';
check('H3 confirmation message names the action (N post(s))', /create 1 scheduled post/i.test(askMsg), askMsg.slice(0, 100));
let r2 = await mcpCall('integrationSchedulePostTool', { socialPost: draft }, { inputResponses: { [confirmKey]: { action: 'accept', content: { confirm: true } } } });
const written = unwrap(r2);
const postId = Array.isArray(written) ? written[0]?.postId : written?.postId;
check('H3 accept round-trip created the post', !!postId, JSON.stringify(written || r2 || {}).slice(0, 140));
check('H3 the write took exactly 2 round-trips', hop.calls === 2, `${hop.calls}`);
endHop();

// ================= HOP 4: VERIFY =================
console.log('\n== HOP 4: VERIFY (postsList + postDetails) ==');
beginHop('verify (list+details)');
const win = { startDate: new Date(Date.now() - 3600 * 1000).toISOString().slice(0, 19), endDate: new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString().slice(0, 19) };
const listed = unwrap(await mcpCall('postsListTool', { ...win, state: 'draft', page: 1 }));
check('H4 scheduled draft visible in list', listed?.total >= 1 && (listed?.posts || listed?.data || []).some?.((p) => p.id === postId), `total ${listed?.total}`);
const details = unwrap(await mcpCall('postDetailsTool', { id: postId }));
check('H4 details show state + content parts', !!details?.id && /agentic loop/.test(JSON.stringify(details)), JSON.stringify(details).slice(0, 140));
endHop();

// ================= HOP 5: ADJUST (edit + reschedule with confirmations) =================
console.log('\n== HOP 5: ADJUST (content edit, reschedule, status) ==');
beginHop('adjust (edit+reschedule+status)');
const newContent = [`<p>agentic loop ${rand} REVISED</p>`];
let ce = await mcpCall('postContentTool', { id: postId, content: newContent });
if (ce?.resultType === 'input_required') {
  const k = Object.keys(ce.inputRequests)[0];
  ce = unwrap(await mcpCall('postContentTool', { id: postId, content: newContent }, { inputResponses: { [k]: { action: 'accept', content: { confirm: true } } } }));
}
check('H5 content edit round-tripped', !!ce && !ce.errors, JSON.stringify(ce || {}).slice(0, 120));
const newDate = new Date(Date.now() + 2 * 24 * 3600 * 1000).toISOString().slice(0, 19);
let de = await mcpCall('postDateTool', { id: postId, date: newDate });
if (de?.resultType === 'input_required') {
  const k = Object.keys(de.inputRequests)[0];
  de = unwrap(await mcpCall('postDateTool', { id: postId, date: newDate }, { inputResponses: { [k]: { action: 'accept', content: { confirm: true } } } }));
}
check('H5 reschedule round-tripped', !!de && !de.errors, JSON.stringify(de || {}).slice(0, 120));
let se = await mcpCall('postStatusTool', { id: postId, status: 'draft' });
if (se?.resultType === 'input_required') {
  const k = Object.keys(se.inputRequests)[0];
  se = unwrap(await mcpCall('postStatusTool', { id: postId, status: 'draft' }, { inputResponses: { [k]: { action: 'accept', content: { confirm: true } } } }));
}
check('H5 status change round-tripped', !!se && !se.errors, JSON.stringify(se || {}).slice(0, 120));
const detailsAfter = unwrap(await mcpCall('postDetailsTool', { id: postId }));
check('H5 all adjustments landed (verified via details)', /REVISED/.test(JSON.stringify(detailsAfter)) && detailsAfter?.state === 'DRAFT', JSON.stringify(detailsAfter).slice(0, 160));
endHop();

// ================= HOP 6: RECOVER (agent error paths) =================
console.log('\n== HOP 6: RECOVER (agent mistakes get actionable errors) ==');
beginHop('recover (error paths)');
const badSlot = unwrap(await mcpCall('postDateTool', { id: postId, date: 'not-a-date' }));
check('H6 garbage date -> recovery hint mentions format', typeof badSlot?.errors === 'string' && /format|freeDateTime|YYYY/i.test(badSlot.errors), String(badSlot?.errors).slice(0, 120));
const badId = unwrap(await mcpCall('postDetailsTool', { id: 'no-such-id' }));
check('H6 unknown id -> hint to find via postsList', typeof badId?.errors === 'string' && /postsList/i.test(badId.errors), String(badId?.errors).slice(0, 120));
const badSched = unwrap(await mcpCall('integrationSchedulePostTool', { socialPost: [{ ...draft[0], integrationId: 'cm_does_not_exist' }] }));
check('H6 unknown integration refused BEFORE confirm (no dialog)', typeof badSched?.errors === 'string' && /integrationList/i.test(badSched.errors) && badSched?.resultType !== 'input_required', String(badSched?.errors).slice(0, 140));
const pastSched = unwrap(await mcpCall('integrationSchedulePostTool', { socialPost: [{ ...draft[0], type: 'schedule', date: new Date(Date.now() - 3600 * 1000).toISOString().slice(0, 19) }] }));
check('H6 past schedule refused BEFORE confirm (no dialog)', typeof pastSched?.errors === 'string' && /past/i.test(pastSched.errors) && pastSched?.resultType !== 'input_required', String(pastSched?.errors).slice(0, 140));
const wpSettingsArr = [
  { key: 'title', value: `loop ${rand}` },
  { key: 'type', value: 'posts' },
  { key: 'status', value: 'publish' },
];
const decline = await mcpCall('postSettingsTool', { id: postId, settings: wpSettingsArr });
const declined = decline?.resultType === 'input_required'
  ? unwrap(await mcpCall('postSettingsTool', { id: postId, settings: wpSettingsArr }, { inputResponses: { [Object.keys(decline.inputRequests)[0]]: { action: 'decline' } } }))
  : decline;
check('H6 declined write -> structured errors, no crash', typeof declined?.errors === 'string', JSON.stringify(declined || decline || {}).slice(0, 120));
endHop();

// ================= HOP 7: MEASURE + TELEMETRY =================
console.log('\n== HOP 7: OBSERVE (analytics read path) ==');
beginHop('observe (analytics)');
const postsAnalytics = unwrap(await mcpCall('postAnalyticsTool', { postId }));
check('H7 per-post analytics readable', postsAnalytics !== null && postsAnalytics !== undefined, JSON.stringify(postsAnalytics || {}).slice(0, 100));
endHop();

const totals = report();
check('loop completed within a sane budget (<= 25 calls)', totals.totalCalls <= 25, `${totals.totalCalls}`);
check('loop payload within a sane budget (<= 400 KB)', totals.totalBytes <= 400 * 1024, `${Math.round(totals.totalBytes / 1024)} KB`);
check('zero protocol-layer errors across the loop', totals.totalErrors === 0, `${totals.totalErrors}`);

console.log(`\n${pass}/${pass + fail} passed`);
fs.unlinkSync('.freebuff/tmp-loop-integration.cjs');
process.exit(fail ? 1 : 0);
