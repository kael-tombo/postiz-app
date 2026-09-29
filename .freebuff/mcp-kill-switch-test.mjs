// Round 19 / F29 — KILL-SWITCH VERIFICATION. The two env overrides must
// restore the exact pre-gate behavior, because operators will use them as
// escape hatches when a host cannot answer elicitation:
//   MCP_CONFIRM_MODE=off      -> modern writes EXECUTE without any dialog
//                                (the elicitation gate is globally off);
//                                pre-flight refusals still work.
//   MCP_PROTOCOL_MODE=legacy  -> pure legacy dispatch: modern-envelope
//                                writes are served the legacy way, i.e.
//                                they EXECUTE (fail-open, no gate) and no
//                                input_required can ever come back.
//   baseline (both unset)     -> modern write round 1 is input_required,
//                                decline refuses, accept executes.
// The same probe body runs in all three modes (PROBE_MODE env) and asserts
// mode-specific expectations against a fresh org.
// Run: PROBE_MODE=baseline|confirm-off|protocol-legacy node .freebuff/mcp-kill-switch-test.mjs
import fs from 'node:fs';
import { execSync } from 'node:child_process';

const BASE = 'http://localhost:3000';
const MODE = process.env.PROBE_MODE || 'baseline';
const rand = Math.floor(Math.random() * 100000);
const PV = 'io.modelcontextprotocol/protocolVersion';
const CC = 'io.modelcontextprotocol/clientCapabilities';
const ERA = '2026-07-28';

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name} ${detail}`); }
}

async function api(method, path, { body, cookie, apiKey, sessionId, extraHeaders } = {}) {
  const headers = { ...(extraHeaders || {}) };
  if (body) headers['content-type'] = 'application/json';
  if (cookie) headers['cookie'] = cookie;
  if (apiKey) headers['authorization'] = `Bearer ${apiKey}`;
  if (sessionId) headers['mcp-session-id'] = sessionId;
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
  return { status: res.status, json, text, sessionId: res.headers.get('mcp-session-id') || '', setCookie: res.headers.getSetCookie?.() || [] };
}
let idc = 0;
const rpc = (method, params, isNotification = false) => ({
  jsonrpc: '2.0', method, ...(isNotification ? {} : { id: ++idc }), ...(params ? { params } : {}),
});
async function callToolRaw(name, args, { modern = true, inputResponses } = {}) {
  const params = { name, arguments: args };
  if (inputResponses) params.inputResponses = inputResponses;
  const body = modern
    ? rpc('tools/call', { ...params, _meta: { [PV]: ERA, [CC]: { elicitation: {} } } })
    : rpc('tools/call', params);
  const r = await api('POST', '/mcp', {
    apiKey,
    sessionId: modern ? '' : legacySid,
    extraHeaders: modern ? { 'mcp-method': 'tools/call', 'mcp-name': name } : {},
    body,
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
async function completeWrite(name, args, decision) {
  let raw = await callToolRaw(name, args);
  if (raw?.resultType === 'input_required') {
    const k = Object.keys(raw.inputRequests)[0];
    raw = await callToolRaw(name, args, { inputResponses: { [k]: decision } });
  }
  return { raw, out: unwrap(raw) };
}

// ---------- setup ----------
const reg = await fetch(BASE + '/auth/register', {
  method: 'POST',
  headers: { 'content-type': 'application/json', accept: 'application/json' },
  body: JSON.stringify({ provider: 'LOCAL', email: `ks${MODE.slice(0, 3)}${rand}@postiz.local`, password: 'KillTest123!', company: 'KS Co' }),
});
const authCookie = ((reg.headers.getSetCookie?.() || []).find((c) => c.startsWith('auth=')) || '').split(';')[0];
const orgId = (await (await fetch(BASE + '/user/self', { headers: { cookie: authCookie } })).json())?.orgId;
const apiKey = (await (await fetch(BASE + '/user/api-key/rotate', { method: 'POST', headers: { cookie: authCookie } })).json())?.apiKey || '';
check('setup: fresh org + key', !!orgId && !!apiKey);

fs.writeFileSync('.freebuff/tmp-ks-integration.cjs', `
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const integration = await p.integration.create({
    data: {
      internalId: 'ks_${MODE}_${rand}',
      organizationId: '${orgId}',
      name: 'Mock WP (ks)',
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
  const out = execSync('node .freebuff/tmp-ks-integration.cjs', { encoding: 'utf8', timeout: 60000 });
  integrationId = (out.match(/INTEGRATION_ID=(\S+)/) || [])[1] || '';
} catch (e) { console.log(String(e.stderr || e.message || '').slice(0, 140)); }
check('setup: mock integration', !!integrationId);

// Legacy-era session for cross-era checks.
let legacySid = '';
{
  const r = await api('POST', '/mcp', {
    apiKey,
    body: rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'ks-legacy', version: '1' } }),
  });
  legacySid = r.sessionId || '';
  await api('POST', '/mcp', { apiKey, sessionId: legacySid, body: rpc('notifications/initialized', undefined, true) });
  // Stateless JSON mounts never return mcp-session-id; the legacy contract
  // is just: initialize answers with serverInfo and envelope-less calls run.
  check('legacy initialize contract holds', r.status === 200 && !!r.json?.result?.serverInfo, `status ${r.status}`);
}

const tomorrow = new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 19);
const schedArgs = (n) => ({ socialPost: [{ integrationId, isPremium: false, date: tomorrow, shortLink: false, type: 'schedule', postsAndComments: [{ content: `<p>ks ${rand} #${n}</p>`, attachments: [] }], settings: [{ key: 'title', value: `KS ${rand}` }, { key: 'type', value: 'posts' }, { key: 'status', value: 'publish' }] }] });
const window1 = {
  startDate: new Date(Date.now() - 3600 * 1000).toISOString().slice(0, 19),
  endDate: new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString().slice(0, 19),
};

console.log(`== MODE: ${MODE} ==`);
// ---------- the central contract: modern write first round ----------
const first = await callToolRaw('integrationSchedulePostTool', schedArgs(1));
if (MODE === 'baseline') {
  check('baseline: modern write round1 is input_required', first?.resultType === 'input_required', JSON.stringify(first || {}).slice(0, 140));
  const k = Object.keys(first?.inputRequests || {})[0];
  const declined = unwrap(await callToolRaw('integrationSchedulePostTool', schedArgs(1), { inputResponses: { [k]: { action: 'decline' } } }));
  check('baseline: decline refuses', typeof declined?.errors === 'string', JSON.stringify(declined).slice(0, 120));
  const accepted = await completeWrite('integrationSchedulePostTool', schedArgs(1), { action: 'accept', content: { confirm: true } });
  check('baseline: accept creates the post', Array.isArray(accepted.out) && !!accepted.out[0]?.postId, JSON.stringify(accepted.out || {}).slice(0, 120));
} else {
  check(`${MODE}: modern write round1 is NOT input_required (gate off)`, first?.resultType !== 'input_required', JSON.stringify(first || {}).slice(0, 140));
  const out = unwrap(first);
  const created = Array.isArray(out) ? out[0]?.postId : out?.created?.[0]?.postId;
  check(`${MODE}: write EXECUTED immediately (pre-gate behavior)`, !!created, JSON.stringify(out || {}).slice(0, 140));
  const det = unwrap(await callToolRaw('postDetailsTool', { id: created }));
  check(`${MODE}: created post readable and queued`, !!det && /QUEUE|DRAFT/.test(JSON.stringify(det)), JSON.stringify(det || {}).slice(0, 120));
}

// ---------- pre-flight refusals survive every mode ----------
const doomed = unwrap(await callToolRaw('postStatusTool', { id: 'nosuch-' + rand, status: 'draft' }));
check(`${MODE}: pre-flight refusal intact (unknown id, no dialog)`,
  typeof doomed?.errors === 'string' && /postsList|not found/i.test(doomed.errors), JSON.stringify(doomed).slice(0, 120));

// ---------- legacy-era session always executes (both modes, both switches) ----------
const legacyOut = unwrap(await callToolRaw('integrationSchedulePostTool', schedArgs(9), { modern: false }));
const legacyCreated = Array.isArray(legacyOut) ? legacyOut[0]?.postId : legacyOut?.created?.[0]?.postId;
check(`${MODE}: legacy-era session executes without any gate`, !!legacyCreated, JSON.stringify(legacyOut || {}).slice(0, 140));

fs.unlinkSync('.freebuff/tmp-ks-integration.cjs');
console.log(`\n[${MODE}] ${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
