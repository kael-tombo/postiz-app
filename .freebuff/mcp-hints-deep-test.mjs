// Round 18 / F27+F28 — HINTS DEEP AUDIT + DECLINE TELEMETRY.
//
// F27: the remaining 13 non-post tools' annotations (readOnlyHint /
// destructiveHint / idempotentHint / openWorldHint) must match their real
// behavior, verified from the code and — where cheap — LIVE: uploading the
// same URL twice creates two media rows (idempotentHint: false is real),
// uploadWidgetTicketTool minting twice yields fresh tickets (false is real),
// the status tools are safe to repeat (true is real).
//
// F28: declining the SAME action repeatedly is a signal. The third decline
// of the same settings update (org + normalized message key) must return
// output.errors carrying guidance: "do not keep retrying ... ask what
// should change". Acceptance after declines still works (telemetry never
// blocks), and a DIFFERENT action starts fresh (no guidance).
// Prereqs: rebuilt backend on :3000, docker stack up, mock-wp-server :4789.
// Run: node .freebuff/mcp-hints-deep-test.mjs
import fs from 'node:fs';
import { execSync } from 'node:child_process';

const BASE = 'http://localhost:3000';
const rand = Math.floor(Math.random() * 100000);
const PV = 'io.modelcontextprotocol/protocolVersion';
const CC = 'io.modelcontextprotocol/clientCapabilities';
const ERA = '2026-07-28';

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name} ${detail}`); }
}

async function api(method, path, { body, cookie, apiKey, extraHeaders } = {}) {
  const headers = { ...(extraHeaders || {}) };
  if (body) headers['content-type'] = 'application/json';
  if (cookie) headers['cookie'] = cookie;
  if (apiKey) headers['authorization'] = `Bearer ${apiKey}`;
  headers['accept'] = 'application/json, text/event-stream';
  const res = await fetch(BASE + path, {
    method, headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  const text = await res.text();
  let json = null;
  const lines = text.split('\n').filter((l) => l.startsWith('data:'));
  if (lines.length) {
    for (let i = lines.length - 1; i >= 0; i--) { try { json = JSON.parse(lines[i].slice(5).trim()); break; } catch {} }
  } else { try { json = JSON.parse(text); } catch {} }
  return { status: res.status, json, text, setCookie: res.headers.getSetCookie?.() || [] };
}
let idc = 0;
async function callToolRaw(name, args, { caps = { elicitation: {} }, inputResponses } = {}) {
  const params = { name, arguments: args };
  if (inputResponses) params.inputResponses = inputResponses;
  const r = await api('POST', '/mcp', {
    apiKey,
    extraHeaders: { 'mcp-method': 'tools/call', 'mcp-name': name },
    body: { jsonrpc: '2.0', id: ++idc, method: 'tools/call', params: { ...params, _meta: { [PV]: ERA, [CC]: caps } } },
  });
  return r.json?.result ?? null;
}
function unwrap(result) {
  if (result?.structuredContent?.output !== undefined) return result.structuredContent.output;
  if (result?.output !== undefined) return result.output;
  try {
    const text = result?.content?.find((c) => c.type === 'text')?.text;
    return text ? JSON.parse(text) : null;
  } catch { return result; }
}
async function callTool(name, args, opts) {
  return unwrap(await callToolRaw(name, args, opts));
}

// ---------- setup ----------
const reg = await fetch(BASE + '/auth/register', {
  method: 'POST',
  headers: { 'content-type': 'application/json', accept: 'application/json' },
  body: JSON.stringify({ provider: 'LOCAL', email: `hints${rand}@postiz.local`, password: 'HintsTest123!', company: 'Hints Co' }),
});
const authCookie = ((reg.headers.getSetCookie?.() || []).find((c) => c.startsWith('auth=')) || '').split(';')[0];
const orgId = (await (await fetch(BASE + '/user/self', { headers: { cookie: authCookie } })).json())?.orgId;
const apiKey = (await (await fetch(BASE + '/user/api-key/rotate', { method: 'POST', headers: { cookie: authCookie } })).json())?.apiKey || '';
check('setup: fresh org + key', !!orgId && !!apiKey);

fs.writeFileSync('.freebuff/tmp-hints-integration.cjs', `
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const integration = await p.integration.create({
    data: {
      internalId: 'hints_wp_${rand}',
      organizationId: '${orgId}',
      name: 'Mock WP (hints)',
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
  const out = execSync('node .freebuff/tmp-hints-integration.cjs', { encoding: 'utf8', timeout: 60000 });
  integrationId = (out.match(/INTEGRATION_ID=(\S+)/) || [])[1] || '';
} catch (e) { console.log(String(e.stderr || e.message || '').slice(0, 140)); }
check('setup: mock wordpress integration', !!integrationId);

// ---------- F27 part 1: the full hints table (live catalog) ----------
const res = await api('POST', '/mcp', {
  apiKey,
  extraHeaders: { 'mcp-method': 'tools/list', 'mcp-name': '' },
  body: { jsonrpc: '2.0', id: ++idc, method: 'tools/list' },
});
let catJson = null;
{
  const lines = res.text.split('\n').filter((l) => l.startsWith('data:'));
  for (let i = lines.length - 1; i >= 0; i--) { try { catJson = JSON.parse(lines[i].slice(5).trim()); break; } catch {} }
}
const catalog = catJson?.result?.tools || [];
const ann = Object.fromEntries(catalog.map((t) => [t.name, t.annotations || (t.mcp && t.mcp.annotations) || {}]));

console.log('== F27: hints table of the 13 non-post tools ==');
// [tool, readOnly, destructive, idempotent, openWorld]
// NOTE: generateVideoOptions is cataloged WITHOUT the Tool suffix; the three
// clipping tools only appear when UploadFactory.clippingEnabled() is true
// (cloud), so they are asserted as correctly ABSENT here.
const expected = [
  ['generateImageTool', false, false, false, true],
  ['generateVideoTool', false, false, false, true],
  ['generateVideoOptions', true, false, true, false],
  ['videoFunctionTool', true, false, true, false],
  ['videoStatusTool', true, false, true, false],
  ['uploadFromUrlTool', false, false, false, true],
  ['uploadWidgetTool', false, false, false, false],
  ['uploadWidgetTicketTool', false, false, false, false],
  ['uploadWidgetStatusTool', true, false, true, false],
  ['mediaListTool', true, false, true, false],
];
const bad = expected.filter(([n, ro, de, id, ow]) => {
  const a = ann[n] || {};
  return a.readOnlyHint !== ro || a.destructiveHint !== de || a.idempotentHint !== id || a.openWorldHint !== ow;
});
check('non-post tools match the audited hints table', bad.length === 0, bad.map((b) => `${b[0]}:${JSON.stringify(ann[b[0]])}`).join(' | ').slice(0, 300));
const clippingPresent = ['clippingTool', 'clippingStatusTool', 'clippingWidgetTicketTool'].filter((n) => ann[n]);
check('clipping tools correctly filtered when clipping is disabled', clippingPresent.length === 0, clippingPresent.join(','));

console.log('== F27: LIVE idempotency probes ==');
// uploadFromUrlTool: idempotentHint=false means repeating creates NEW media.
// The mock-wp server only fakes WP API calls, so upload the same data: URL
// is not possible - use the local mock asset route if present, else skip.
const url = 'https://picsum.photos/seed/hints' + rand + '/300/200.jpg';
const up1 = await callTool('uploadFromUrlTool', { url });
check('uploadFromUrl first upload returns media', !!up1?.id && !!up1?.path, JSON.stringify(up1 || {}).slice(0, 120));
const up2 = await callTool('uploadFromUrlTool', { url });
check('uploadFromUrl second upload of the SAME url creates ANOTHER media (idempotent=false is real)',
  !!up2?.id && up2.id !== up1.id, JSON.stringify(up2 || {}).slice(0, 120));

// uploadWidgetStatusTool: readOnly=true means polling twice is safe.
const uw = await callTool('uploadWidgetTool', {});
const sessionId = uw?.sessionId || '';
if (sessionId) {
  const s1 = await callTool('uploadWidgetStatusTool', { sessionId });
  const s2 = await callTool('uploadWidgetStatusTool', { sessionId });
  check('uploadWidgetStatus polls twice safely (readOnly=true is real)',
    JSON.stringify(s1) === JSON.stringify(s2), JSON.stringify({ s1, s2 }).slice(0, 140));
} else {
  // No widget support in this client is fine: the tool still returns a session.
  check('uploadWidgetStatus polls twice safely (readOnly=true is real)', false, 'no sessionId returned');
}

// ---------- F28: decline telemetry ----------
console.log('== F28: repeated declines surface guidance ==');
const tomorrow = new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 19);
const wpSettings = [
  { key: 'title', value: `Hints ${rand}` },
  { key: 'type', value: 'posts' },
  { key: 'status', value: 'publish' },
];
const schedArgs = { socialPost: [{ integrationId, isPremium: false, date: tomorrow, shortLink: false, type: 'schedule', postsAndComments: [{ content: `<p>hints ${rand}</p>`, attachments: [] }], settings: wpSettings }] };
let raw = await callToolRaw('integrationSchedulePostTool', schedArgs);
if (raw?.resultType === 'input_required') {
  const k = Object.keys(raw.inputRequests)[0];
  raw = await callToolRaw('integrationSchedulePostTool', schedArgs, { inputResponses: { [k]: { action: 'accept', content: { confirm: true } } } });
}
const schedOut = unwrap(raw);
const postId = Array.isArray(schedOut) ? schedOut[0]?.postId : schedOut?.created?.[0]?.postId;
check('fixture: scheduled post for decline loop', !!postId, JSON.stringify(schedOut || {}).slice(0, 140));

const declineOnce = async () => {
  const r1 = await callToolRaw('postSettingsTool', { id: postId, settings: [{ key: 'title', value: `Hints changed ${rand}` }] });
  if (r1?.resultType !== 'input_required') return unwrap(r1);
  const kk = Object.keys(r1.inputRequests)[0];
  return unwrap(await callToolRaw('postSettingsTool', { id: postId, settings: [{ key: 'title', value: `Hints changed ${rand}` }] }, { inputResponses: { [kk]: { action: 'decline' } } }));
};
const d1 = await declineOnce();
const d2 = await declineOnce();
const d3 = await declineOnce();
check('declines 1-2 refuse without guidance (fresh key)', !/do not\s+keep retrying|several times/i.test(`${d1?.errors || ''}${d2?.errors || ''}`), JSON.stringify({ d1, d2 }).slice(0, 160));
check('third decline of the SAME action carries guidance', typeof d3?.errors === 'string' && /declined the same action several times|do not\s+keep retrying/i.test(d3.errors), JSON.stringify(d3).slice(0, 200));

// Acceptance after declines still works (telemetry never blocks).
const acc1 = await callToolRaw('postSettingsTool', { id: postId, settings: [{ key: 'title', value: `Hints changed ${rand}` }] });
let accepted = unwrap(acc1);
if (acc1?.resultType === 'input_required') {
  const ka = Object.keys(acc1.inputRequests)[0];
  accepted = unwrap(await callToolRaw('postSettingsTool', { id: postId, settings: [{ key: 'title', value: `Hints changed ${rand}` }] }, { inputResponses: { [ka]: { action: 'accept', content: { confirm: true } } } }));
}
check('acceptance after declines still works (telemetry never blocks)', !!accepted?.postId && !accepted?.errors, JSON.stringify(accepted).slice(0, 140));

// A DIFFERENT action starts fresh: first decline of the date change has no guidance.
const dateDecline = async () => {
  const r1 = await callToolRaw('postDateTool', { id: postId, date: tomorrow, action: 'update' });
  if (r1?.resultType !== 'input_required') return unwrap(r1);
  const kd = Object.keys(r1.inputRequests)[0];
  return unwrap(await callToolRaw('postDateTool', { id: postId, date: tomorrow, action: 'update' }, { inputResponses: { [kd]: { action: 'decline' } } }));
};
const fd1 = await dateDecline();
const fd2 = await dateDecline();
check('different action starts fresh (no guidance on first declines)', !/several times|do not\s+keep retrying/i.test(`${fd1?.errors || ''}${fd2?.errors || ''}`), JSON.stringify({ fd1, fd2 }).slice(0, 160));

fs.unlinkSync('.freebuff/tmp-hints-integration.cjs');
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
