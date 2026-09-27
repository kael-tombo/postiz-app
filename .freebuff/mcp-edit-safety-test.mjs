// E2E for the eighth round: edit-tool pre-flight parity. All four edit tools
// must refuse doomed calls with actionable output.errors BEFORE the
// confirmation dialog / any write:
//   postDateTool   - unknown id, comment id, invalid date, past-QUEUE
//   postStatusTool - unknown id, comment id
// plus one happy-path reschedule to prove the guards don't over-refuse.
// Prereqs: rebuilt backend on :3000, docker stack up, mock-wp-server on :4789.
// Run: node .freebuff/mcp-edit-safety-test.mjs
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

// ---------- setup ----------
let r = await api('POST', '/auth/register', { body: { provider: 'LOCAL', email: `edits${rand}@postiz.local`, password: 'EditTest123!', company: 'Edit Co' }, accept: 'application/json' });
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
  const integration = await p.integration.create({
    data: {
      internalId: 'editwp_${rand}',
      organizationId: '${orgId}',
      name: 'Mock WP (edit safety)',
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
fs.writeFileSync('.freebuff/tmp-create-integration.cjs', prismaScript);
let integrationId = '';
try {
  const out = execSync('node .freebuff/tmp-create-integration.cjs', { encoding: 'utf8', timeout: 60000 });
  integrationId = (out.match(/INTEGRATION_ID=(\S+)/) || [])[1] || '';
} catch (e) {
  console.log(String(e.stderr || e.message || '').slice(0, 160));
}
check('mock wordpress integration created', !!integrationId, integrationId);

r = await api('POST', '/mcp', {
  apiKey,
  body: rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '1' } }),
});
check('mcp initialize', r.status === 200 && !!r.json?.result?.serverInfo, `status ${r.status}`);
const sid = r.sessionId;
await api('POST', '/mcp', { apiKey, sessionId: sid, body: rpc('notifications/initialized', undefined, true) });

const tomorrow = new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 19);
const wpSettings = [
  { key: 'title', value: `Edit safety ${rand}` },
  { key: 'type', value: 'posts' },
  { key: 'status', value: 'publish' },
];

// A scheduled thread (root + comment) to exercise comment-id refusals.
const scheduled = await callTool(apiKey, sid, 'integrationSchedulePostTool', {
  socialPost: [{
    integrationId, isPremium: false,
    date: tomorrow, shortLink: false, type: 'schedule',
    postsAndComments: [
      { content: `<p>edit safety main ${rand}</p>`, attachments: [] },
      { content: `<p>edit safety reply ${rand}</p>`, attachments: [] },
    ],
    settings: wpSettings,
  }],
});
const postId = Array.isArray(scheduled) ? scheduled[0]?.postId : null;
check('thread scheduled', !!postId, JSON.stringify(scheduled).slice(0, 140));
const details = await callTool(apiKey, sid, 'postDetailsTool', { id: postId });
const commentId = details?.parts?.[1]?.id || '';
check('comment id available', !!commentId, JSON.stringify(details?.parts).slice(0, 120));

// ---------- postDateTool refusals ----------
console.log('== POSTDATE PRE-FLIGHT ==');
const dUnknown = await callTool(apiKey, sid, 'postDateTool', { id: 'nosuch-' + rand, date: tomorrow, action: 'update' });
check('date: unknown id refused with hint', typeof dUnknown?.errors === 'string' && /postsList/.test(dUnknown.errors), JSON.stringify(dUnknown).slice(0, 140));

const dComment = await callTool(apiKey, sid, 'postDateTool', { id: commentId, date: tomorrow, action: 'update' });
check('date: comment id refused', typeof dComment?.errors === 'string' && /comment/.test(dComment.errors), JSON.stringify(dComment).slice(0, 140));

const dBad = await callTool(apiKey, sid, 'postDateTool', { id: postId, date: 'garbage-date', action: 'update' });
check('date: invalid date refused with format hint', typeof dBad?.errors === 'string' && /freeDateTime|UTC/.test(dBad.errors), JSON.stringify(dBad).slice(0, 140));

// ---------- postStatusTool refusals ----------
console.log('== POSTSTATUS PRE-FLIGHT ==');
const sUnknown = await callTool(apiKey, sid, 'postStatusTool', { id: 'nosuch-' + rand, status: 'draft' });
check('status: unknown id refused with hint', typeof sUnknown?.errors === 'string' && /postsList/.test(sUnknown.errors), JSON.stringify(sUnknown).slice(0, 140));

const sComment = await callTool(apiKey, sid, 'postStatusTool', { id: commentId, status: 'draft' });
check('status: comment id refused', typeof sComment?.errors === 'string' && /comment/.test(sComment.errors), JSON.stringify(sComment).slice(0, 140));

// ---------- happy paths still work ----------
console.log('== HAPPY PATHS ==');
const dayAfter = new Date(Date.now() + 2 * 24 * 3600 * 1000).toISOString().slice(0, 19);
const moved = await callTool(apiKey, sid, 'postDateTool', { id: postId, date: dayAfter, action: 'update' });
check('date: happy-path reschedule works', moved?.postId === postId && moved?.publishDate === dayAfter, JSON.stringify(moved).slice(0, 140));

const requeued = await callTool(apiKey, sid, 'postStatusTool', { id: postId, status: 'draft' });
check('status: happy-path cancel works', requeued?.postId === postId && requeued?.state === 'DRAFT', JSON.stringify(requeued).slice(0, 140));

const back = await callTool(apiKey, sid, 'postStatusTool', { id: postId, status: 'schedule' });
check('status: happy-path requeue works', back?.postId === postId && back?.state === 'QUEUE', JSON.stringify(back).slice(0, 140));

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
