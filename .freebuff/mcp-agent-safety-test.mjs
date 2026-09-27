// E2E for the seventh round: agent-safety pre-flight on the schedule tool
// plus the "post now" timezone regression.
//   1. unknown channel id  -> output.errors with recovery hint, no raw crash
//   2. disabled channel    -> output.errors (reconnect hint), nothing created
//   3. invalid date        -> output.errors teaching the UTC format
//   4. past date           -> output.errors (drafts still allowed in the past)
//   5. type:"now" publishes NOW (UTC wall time), not offset hours later
// Prereqs: rebuilt backend on :3000, docker stack up, mock-wp-server on :4789.
// Run: node .freebuff/mcp-agent-safety-test.mjs
import fs from 'node:fs';
import { execSync } from 'node:child_process';

const BASE = 'http://localhost:3000';
const rand = Math.floor(Math.random() * 100000);

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name} ${detail}`); }
}

async function api(method, path, { body, cookie, apiKey, sessionId, accept } = {}) {
  const headers = {};
  if (body) headers['content-type'] = 'application/json';
  if (cookie) headers['cookie'] = cookie;
  if (apiKey) headers['authorization'] = `Bearer ${apiKey}`;
  headers['accept'] = accept || 'application/json, text/event-stream';
  if (sessionId) headers['mcp-session-id'] = sessionId;
  const res = await fetch(BASE + path, {
    method, headers,
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
    signal: AbortSignal.timeout(25000),
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
async function callTool(apiKey, sid, name, args) {
  const r = await api('POST', '/mcp', {
    apiKey, sessionId: sid,
    body: rpc('tools/call', { name, arguments: args }),
  });
  return unwrap(r.json?.result);
}

// ---------- setup: user + key + enabled + disabled mock channels ----------
let r = await api('POST', '/auth/register', { body: { provider: 'LOCAL', email: `safety${rand}@postiz.local`, password: 'SafetyTest123!', company: 'Safety Co' }, accept: 'application/json' });
const cookie = (r.setCookie.find((c) => c.startsWith('auth=')) || '').split(';')[0];
r = await api('GET', '/user/self', { cookie });
const orgId = r.json?.orgId;
check('register + session', !!orgId, `status ${r.status}`);
r = await api('POST', '/user/api-key/rotate', { cookie });
const apiKey = r.json?.apiKey || r.json?.key || '';
check('api key rotated', !!apiKey);

const prismaScript = `
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const base = {
    organizationId: '${orgId}',
    providerIdentifier: 'wordpress',
    type: 'article',
    token: '${Buffer.from(JSON.stringify({ domain: 'http://127.0.0.1:4789', username: 'u', password: 'p' })).toString('base64')}',
    picture: '',
  };
  const enabled = await p.integration.create({ data: { ...base, internalId: 'safewp_${rand}', name: 'Mock WP (safety)' } });
  const disabled = await p.integration.create({ data: { ...base, internalId: 'safewpoff_${rand}', name: 'Mock WP disabled (safety)', disabled: true } });
  console.log('INTEGRATION_ID=' + enabled.id);
  console.log('DISABLED_ID=' + disabled.id);
  await p.$disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
`;
fs.writeFileSync('.freebuff/tmp-create-integration.cjs', prismaScript);
let integrationId = '', disabledId = '';
try {
  const out = execSync('node .freebuff/tmp-create-integration.cjs', { encoding: 'utf8', timeout: 60000 });
  integrationId = (out.match(/INTEGRATION_ID=(\S+)/) || [])[1] || '';
  disabledId = (out.match(/DISABLED_ID=(\S+)/) || [])[1] || '';
} catch (e) {
  console.log(String(e.stderr || e.message || '').slice(0, 160));
}
check('mock channels created (enabled + disabled)', !!integrationId && !!disabledId, `${integrationId} ${disabledId}`);

// ---------- MCP session ----------
r = await api('POST', '/mcp', {
  apiKey,
  body: rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '1' } }),
});
check('mcp initialize', r.status === 200 && !!r.json?.result?.serverInfo, `status ${r.status}`);
const sid = r.sessionId;
await api('POST', '/mcp', { apiKey, sessionId: sid, body: rpc('notifications/initialized', undefined, true) });

const tomorrow = new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 19);
const wpSettings = [
  { key: 'title', value: `Safety ${rand}` },
  { key: 'type', value: 'posts' },
  { key: 'status', value: 'publish' },
];
const baseArgs = (over = {}) => ({
  socialPost: [{
    integrationId, isPremium: false,
    date: tomorrow, shortLink: false, type: 'draft',
    postsAndComments: [{ content: `<p>safety test ${rand}</p>`, attachments: [] }],
    settings: [],
    ...over,
  }],
});

// ---------- 1. unknown channel ----------
console.log('== UNKNOWN CHANNEL ==');
const unknown = await callTool(apiKey, sid, 'integrationSchedulePostTool', baseArgs({ integrationId: 'nosuchchannel-' + rand }));
check('unknown channel refused with errors', typeof unknown?.errors === 'string', JSON.stringify(unknown).slice(0, 160));
check('unknown channel error names the id + hint', /nosuchchannel/.test(unknown?.errors || '') && /integrationList/.test(unknown?.errors || ''), String(unknown?.errors));

// ---------- 2. disabled channel ----------
console.log('== DISABLED CHANNEL ==');
const disabled = await callTool(apiKey, sid, 'integrationSchedulePostTool', baseArgs({ integrationId: disabledId }));
check('disabled channel refused with errors', typeof disabled?.errors === 'string', JSON.stringify(disabled).slice(0, 160));
check('disabled channel error is actionable', /disabled/.test(disabled?.errors || '') && /reconnect/i.test(disabled?.errors || ''), String(disabled?.errors));

// ---------- 3. invalid date ----------
console.log('== INVALID DATE ==');
const badDate = await callTool(apiKey, sid, 'integrationSchedulePostTool', baseArgs({ date: 'not-a-date' }));
check('invalid date refused with errors', typeof badDate?.errors === 'string', JSON.stringify(badDate).slice(0, 160));
check('invalid date error teaches the format', /freeDateTime|UTC/.test(badDate?.errors || ''), String(badDate?.errors));

// ---------- 4. past date (schedule) vs draft ----------
console.log('== PAST DATE ==');
const past = await callTool(apiKey, sid, 'integrationSchedulePostTool', baseArgs({ type: 'schedule', date: '2020-01-01T00:00:00', settings: wpSettings }));
check('past schedule refused with errors', typeof past?.errors === 'string' && /past/.test(past.errors), JSON.stringify(past).slice(0, 160));
const pastDraft = await callTool(apiKey, sid, 'integrationSchedulePostTool', baseArgs({ type: 'draft', date: '2020-01-01T00:00:00' }));
check('draft in the past still allowed', Array.isArray(pastDraft) && pastDraft[0]?.postId, JSON.stringify(pastDraft).slice(0, 140));

// nothing was created by the refusals (only the 2020 draft exists)
const window = {
  startDate: '2019-01-01T00:00:00',
  endDate: new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString().slice(0, 19),
};
const list = await callTool(apiKey, sid, 'postsListTool', { ...window, page: 1 });
check('refusals created nothing (only the draft exists)', list?.total === 1, `total ${list?.total}`);

// ---------- 5. type:"now" publishes immediately at the right time ----------
console.log('== POST NOW (timezone regression) ==');
// Schedule a "now" post ~1 min in the future and watch publish happen at
// now+0..2min, NOT at now+3h (the local-offset bug would push it past the
// window on a UTC+3 host).
const nowish = new Date(Date.now() + 60 * 1000).toISOString().slice(0, 19);
const nowPost = await callTool(apiKey, sid, 'integrationSchedulePostTool', baseArgs({ type: 'schedule', date: nowish, settings: wpSettings }));
const nowPostId = Array.isArray(nowPost) ? nowPost[0]?.postId : null;
check('post scheduled for +1min', !!nowPostId, JSON.stringify(nowPost).slice(0, 140));

let pubDetails = null, lastState = '';
for (let i = 0; i < 30; i++) {
  await new Promise((res) => setTimeout(res, 6000));
  pubDetails = await callTool(apiKey, sid, 'postDetailsTool', { id: nowPostId });
  lastState = pubDetails?.state || '';
  if (lastState && lastState !== 'QUEUE') break;
}
check('now-ish post published', lastState === 'PUBLISHED', `state ${lastState} ${String(pubDetails?.error || '').slice(0, 120)}`);
if (lastState === 'PUBLISHED') {
  const publishedAt = pubDetails.publishDate; // UTC wall time of the publish
  const t0 = new Date(nowish).getTime();
  const t1 = new Date(publishedAt + 'Z').getTime();
  const withinWindow = t1 >= t0 - 60 * 1000 && t1 <= Date.now() + 60 * 1000 && Date.now() - t1 < 6 * 60 * 1000;
  check('publish time is now-ish, not offset-shifted', withinWindow, `scheduled ${nowish} published ${publishedAt}`);
}

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
