// E2E for the sixth-round MCP agentic-surface improvements:
//   1. postDetailsTool - one post by id (content parts, attachments, state,
//      publishedUrl, error, settings, tags, creationMethod, intervalInDays)
//   2. integrationList outputSchema now exposes disabled/display/type/customer
//   3. postsListTool items carry creationMethod + intervalInDays
//   4. server-level instructions advertised at initialize
// Prereqs: rebuilt backend on :3000, docker stack up, mock-wp-server on :4789.
// Run: node .freebuff/mcp-reads-test.mjs
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

// ---------- setup: user + key + mock channel ----------
let r = await api('POST', '/auth/register', { body: { provider: 'LOCAL', email: `mcprds${rand}@postiz.local`, password: 'ReadsTest123!', company: 'Reads Co' }, accept: 'application/json' });
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
      internalId: 'rdswp_${rand}',
      organizationId: '${orgId}',
      name: 'Mock WP (reads)',
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

// ---------- MCP session (legacy era) ----------
r = await api('POST', '/mcp', {
  apiKey,
  body: rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '1' } }),
});
check('mcp initialize', r.status === 200 && !!r.json?.result?.serverInfo, `status ${r.status}`);
// G4: server instructions advertised to hosts at initialize
const instructions = r.json?.result?.instructions || '';
check('initialize advertises server instructions', typeof instructions === 'string' && instructions.includes('integrationList') && instructions.includes('UTC'), (instructions || '(none)').slice(0, 80));
const sid = r.sessionId;
await api('POST', '/mcp', { apiKey, sessionId: sid, body: rpc('notifications/initialized', undefined, true) });

// tools/list shows the new tool
r = await api('POST', '/mcp', { apiKey, sessionId: sid, body: rpc('tools/list', {}) });
const toolNames = (r.json?.result?.tools || []).map((t) => t.name);
check('postDetails tool is listed', toolNames.includes('postDetailsTool'), toolNames.join(','));

// ---------- 1. integrationList schema fields (G2) ----------
console.log('== INTEGRATIONLIST FIELDS ==');
r = await api('POST', '/mcp', { apiKey, sessionId: sid, body: rpc('tools/list', {}) });
const integrationListSchema = (r.json?.result?.tools || []).find((t) => t.name === 'integrationList');
const schemaJson = JSON.stringify(integrationListSchema?.outputSchema || {});
check('integrationList schema has disabled', schemaJson.includes('disabled'), schemaJson.slice(0, 120));
check('integrationList schema has display', schemaJson.includes('display'));
check('integrationList schema has type', schemaJson.includes('type'));
check('integrationList schema has customer', schemaJson.includes('customer'));

const integrations = await callTool(apiKey, sid, 'integrationList', {});
const mine = (integrations || []).find((i) => i.id === integrationId);
check('integrationList returns the channel', !!mine, JSON.stringify(integrations).slice(0, 140));
check('channel carries disabled/display/type', mine && typeof mine.disabled === 'boolean' && typeof mine.display === 'string' && mine.type === 'article', JSON.stringify(mine || {}).slice(0, 160));

// ---------- 2. schedule a thread (2 parts) + list fields (G3) ----------
console.log('== POSTSLIST FIELDS ==');
// Schedule into the next free slot (imminent) so the publish workflow runs it
// within the test's polling window - a tomorrow date would legitimately sit
// in QUEUE until then.
const freeSlot = (await callTool(apiKey, sid, 'freeDateTimeTool', {}))?.date;
check('got a free slot to schedule into', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(freeSlot || ''), String(freeSlot));
const scheduled = await callTool(apiKey, sid, 'integrationSchedulePostTool', {
  socialPost: [{
    integrationId, isPremium: false,
    date: freeSlot, shortLink: false, type: 'schedule',
    postsAndComments: [
      { content: `<p>reads test main ${rand}</p>`, attachments: [] },
      { content: `<p>reads test reply ${rand}</p>`, attachments: [] },
    ],
    // wordpress articles validate settings: title/type/status required
    settings: [
      { key: 'title', value: `Reads test ${rand}` },
      { key: 'type', value: 'posts' },
      { key: 'status', value: 'publish' },
    ],
  }],
});
check('thread scheduled', Array.isArray(scheduled) && scheduled[0]?.postId, JSON.stringify(scheduled).slice(0, 140));
const postId = Array.isArray(scheduled) ? scheduled[0]?.postId : null;

const window = {
  startDate: new Date(Date.now() - 3600 * 1000).toISOString().slice(0, 19),
  endDate: new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString().slice(0, 19),
};
const list = await callTool(apiKey, sid, 'postsListTool', { ...window, page: 1 });
const item = (list?.posts || []).find((p) => p.id === postId);
check('postsList returns the thread', !!item, JSON.stringify(list).slice(0, 160));
check('list item carries creationMethod', item?.creationMethod === 'MCP', String(item?.creationMethod));
check('list item carries intervalInDays', item && 'intervalInDays' in item && item.intervalInDays === null, String(item?.intervalInDays));
check('list keeps threadParts', (item?.threadParts || []).length === 2, JSON.stringify(item?.threadParts).slice(0, 120));

// ---------- 3. postDetailsTool (G1) ----------
console.log('== POSTDETAILS TOOL ==');
const details = await callTool(apiKey, sid, 'postDetailsTool', { id: postId });
check('details returned for the scheduled post', details?.id === postId, JSON.stringify(details).slice(0, 200));
check('details state is QUEUE', details?.state === 'QUEUE', String(details?.state));
check('details publishDate is UTC wall time', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(details?.publishDate || ''), String(details?.publishDate));
check('details parts ordered main->comment', (details?.parts || []).length === 2 && details.parts[0].isComment === false && details.parts[1].isComment === true && details.parts[1].content.includes('reply'), JSON.stringify(details?.parts).slice(0, 160));
check('details carry channel + creationMethod', details?.integrationId === integrationId && details?.platform === 'wordpress' && details?.creationMethod === 'MCP', JSON.stringify({ i: details?.integrationId, p: details?.platform, c: details?.creationMethod }));
check('details tags is an array', Array.isArray(details?.tags));
check('details has null error/publishedUrl/releaseId before publish', details?.error === null && details?.publishedUrl === null && details?.releaseId === null, JSON.stringify({ e: details?.error, u: details?.publishedUrl, r: details?.releaseId }));
check('details settings parsed to an object', details?.settings && typeof details.settings === 'object' && !Array.isArray(details.settings), JSON.stringify(details?.settings).slice(0, 80));

// negatives
const missing = await callTool(apiKey, sid, 'postDetailsTool', { id: 'nosuchpost-' + rand });
check('unknown id returns errors', typeof missing?.errors === 'string', JSON.stringify(missing).slice(0, 120));

// cross-org isolation: register a second user, same id must 404
let r2 = await api('POST', '/auth/register', { body: { provider: 'LOCAL', email: `mcprdx${rand}@postiz.local`, password: 'ReadsTest123!', company: 'Other Co' }, accept: 'application/json' });
const cookie2 = (r2.setCookie.find((c) => c.startsWith('auth=')) || '').split(';')[0];
r2 = await api('POST', '/user/api-key/rotate', { cookie: cookie2 });
const apiKey2 = r2.json?.apiKey || r2.json?.key || '';
r2 = await api('POST', '/mcp', { apiKey: apiKey2, body: rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't2', version: '1' } }) });
const sid2 = r2.sessionId;
await api('POST', '/mcp', { apiKey: apiKey2, sessionId: sid2, body: rpc('notifications/initialized', undefined, true) });
const foreign = await callTool(apiKey2, sid2, 'postDetailsTool', { id: postId });
check('foreign org cannot read the post', typeof foreign?.errors === 'string' || foreign === null, JSON.stringify(foreign).slice(0, 120));

// ---------- 4. full round trip: publish -> details show the live URL ----------
console.log('== PUBLISHED DETAILS ==');
// The free slot is the next CONFIGURED posting time (possibly hours away),
// so schedule a second post a couple of minutes out to watch the worker
// publish it within the polling window.
const soon = new Date(Date.now() + 2 * 60 * 1000).toISOString().slice(0, 19);
const scheduled2 = await callTool(apiKey, sid, 'integrationSchedulePostTool', {
  socialPost: [{
    integrationId, isPremium: false,
    date: soon, shortLink: false, type: 'schedule',
    postsAndComments: [{ content: `<p>reads publish probe ${rand}</p>`, attachments: [] }],
    settings: [
      { key: 'title', value: `Reads probe ${rand}` },
      { key: 'type', value: 'posts' },
      { key: 'status', value: 'publish' },
    ],
  }],
});
const probeId = Array.isArray(scheduled2) ? scheduled2[0]?.postId : null;
check('probe post scheduled for +2min', !!probeId, JSON.stringify(scheduled2).slice(0, 140));

// Poll postDetailsTool until the state leaves QUEUE.
let pubDetails = null;
let lastState = '';
for (let i = 0; i < 25; i++) {
  await new Promise((res) => setTimeout(res, 6000));
  pubDetails = await callTool(apiKey, sid, 'postDetailsTool', { id: probeId });
  lastState = pubDetails?.state || '';
  if (lastState && lastState !== 'QUEUE') break;
}
check('thread left the queue (worker ran it)', lastState === 'PUBLISHED', `state after polling: ${lastState} ${JSON.stringify(pubDetails?.error || '') .slice(0, 140)}`);
if (lastState === 'PUBLISHED') {
  check('published details carry the live URL', typeof pubDetails?.publishedUrl === 'string' && pubDetails.publishedUrl.startsWith('http'), String(pubDetails?.publishedUrl));
  check('published details carry releaseId', typeof pubDetails?.releaseId === 'string' && pubDetails.releaseId.length > 0, String(pubDetails?.releaseId));
  const publishedList = await callTool(apiKey, sid, 'postsListTool', { ...window, state: 'published', page: 1 });
  check('published filter now includes the post', (publishedList?.posts || []).some((p) => p.id === probeId), JSON.stringify(publishedList?.total));
}

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
