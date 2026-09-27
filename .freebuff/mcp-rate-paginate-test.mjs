// E2E for the two new agentic hardening features:
//   1. postsListTool pagination + state filter (page/total/hasMore output)
//   2. per-org redis rate limit on the MCP write tools (30 writes/min)
// Prereqs: backend rebuilt+restarted, docker stack up, mock-wp-server.mjs on :4789.
// Run: node .freebuff/mcp-rate-paginate-test.mjs
import fs from 'node:fs';
import { execSync } from 'node:child_process';

const BASE = 'http://localhost:3000';

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
    method,
    headers,
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
    apiKey,
    sessionId: sid,
    body: rpc('tools/call', { name, arguments: args }),
  });
  return unwrap(r.json?.result);
}

const rand = Math.floor(Math.random() * 100000);

// ---------- setup: user + key + mock channel ----------
let r = await api('POST', '/auth/register', { body: { provider: 'LOCAL', email: `rpt${rand}@postiz.local`, password: 'RateTest123!', company: 'Rate Co' }, accept: 'application/json' });
const cookie = (r.setCookie.find((c) => c.startsWith('auth=')) || '').split(';')[0];
r = await api('GET', '/user/self', { cookie });
const orgId = r.json?.orgId;
check('register + session', !!orgId, `status ${r.status}`);
r = await api('POST', '/user/api-key/rotate', { cookie });
const apiKey = r.json?.apiKey || r.json?.key || '';
check('api key rotated', !!apiKey);

// inject a mock wordpress channel (same pattern as the lifecycle test)
const prismaScript = `
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const integration = await p.integration.create({
    data: {
      internalId: 'rptwp_${rand}',
      organizationId: '${orgId}',
      name: 'Mock WP (rate/paginate)',
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

// ---------- MCP session ----------
r = await api('POST', '/mcp', {
  apiKey,
  body: rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '1' } }),
});
check('mcp initialize', r.status === 200 && !!r.json?.result?.serverInfo, `status ${r.status}`);
const sid = r.sessionId; // serverless mount: may be empty, calls work regardless
await api('POST', '/mcp', { apiKey, sessionId: sid, body: rpc('notifications/initialized', undefined, true) });

// ---------- 1. pagination + state filter ----------
console.log('== PAGINATION + STATE FILTER ==');
const tomorrow = new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 19);
const dayAfter = new Date(Date.now() + 2 * 24 * 3600 * 1000).toISOString().slice(0, 19);

// create 25 draft posts spread over two days (25 > PAGE_SIZE 20).
// NOTE: drafts are writes too - this deliberately burns 25 of the 30/min budget.
let created = 0, createStopped = false;
for (let i = 0; i < 25; i++) {
  const date = (i % 2 === 0 ? tomorrow : dayAfter);
  const out = await callTool(apiKey, sid, 'integrationSchedulePostTool', {
    socialPost: [{
      integrationId,
      isPremium: false,
      date,
      shortLink: false,
      type: 'draft',
      postsAndComments: [{ content: `<p>paginate test ${rand} #${i}</p>`, attachments: [] }],
      settings: [],
    }],
  });
  if (Array.isArray(out) && out[0]?.postId) created++;
  else { console.log('  create stopped:', JSON.stringify(out).slice(0, 140)); createStopped = true; break; }
}
check('25 drafts created', created === 25, `created ${created}${createStopped ? ' (stopped early)' : ''}`);

const window = {
  startDate: new Date(Date.now() - 3600 * 1000).toISOString().slice(0, 19),
  endDate: new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString().slice(0, 19),
};
const page1 = await callTool(apiKey, sid, 'postsListTool', { ...window, page: 1 });
check('page 1 capped at 20', page1?.posts?.length === 20, `got ${page1?.posts?.length}`);
check('page 1 has page=1', page1?.page === 1);
check('page 1 total=25', page1?.total === 25, `total ${page1?.total}`);
check('page 1 hasMore=true', page1?.hasMore === true);
check('sorted oldest first', !!page1?.posts?.[0] && page1.posts[0].publishDate <= page1.posts[19].publishDate);

const page2 = await callTool(apiKey, sid, 'postsListTool', { ...window, page: 2 });
check('page 2 has remaining 5', page2?.posts?.length === 5, `got ${page2?.posts?.length}`);
check('page 2 hasMore=false', page2?.hasMore === false);

const drafts = await callTool(apiKey, sid, 'postsListTool', { ...window, state: 'draft', page: 1 });
check('state=draft returns all 25 drafts', drafts?.total === 25, `total ${drafts?.total}`);

const scheduled = await callTool(apiKey, sid, 'postsListTool', { ...window, state: 'scheduled', page: 1 });
check('state=scheduled returns 0', scheduled?.total === 0, `total ${scheduled?.total}`);

// ---------- 2. write rate limit ----------
console.log('== WRITE RATE LIMIT ==');
// 25 writes already used. Limit is 30/min -> trips within ~5 more calls.
let limited = false, beforeLimit = 0;
for (let i = 0; i < 40; i++) {
  const out = await callTool(apiKey, sid, 'postStatusTool', {
    id: 'nosuchpost' + i,
    status: 'draft',
  });
  if (JSON.stringify(out).includes('Rate limit reached')) { limited = true; beforeLimit = i; break; }
}
check('write rate limit trips', limited, 'no limit after 40 calls');
if (limited) check('limit trips within budget', beforeLimit <= 6, `tripped after ${beforeLimit} extra calls`);

const after = await callTool(apiKey, sid, 'postStatusTool', { id: 'x', status: 'draft' });
check('still limited in same window', JSON.stringify(after).includes('Rate limit reached'));

const reads = await callTool(apiKey, sid, 'postsListTool', { startDate: '2026-01-01T00:00:00', endDate: '2026-01-02T00:00:00', page: 1 });
check('read tools unaffected', Array.isArray(reads?.posts));

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
