// MCP integration e2e: exercises the real MCP server mounted at /mcp.
//
//   1. Register a user, rotate an org API key (pos_-style bearer credential).
//   2. Inject a mock wordpress channel (same Prisma pattern as the lifecycle test).
//   3. JSON-RPC over HTTP against /mcp: initialize -> tools/list (expect the two
//      new analytics tools) -> tools/call both tools -> negative auth checks.
//   4. Also verify the /mcp/:id API-key-in-path transport.
//
// Prereqs: backend rebuilt (cd apps/backend && pnpm exec nest build) and
// restarted (powershell -File .freebuff/start-backend.ps1); docker stack up.
//
// Run: node .freebuff/mcp-analytics-test.mjs
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
    // SSE framing: take the last data: line that parses as JSON
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
  // Mastra wraps tool output in structuredContent.output; fall back to the text content block.
  if (result?.structuredContent?.output) return result.structuredContent.output;
  if (result?.output) return result.output;
  try {
    const text = result?.content?.find((c) => c.type === 'text')?.text;
    return text ? JSON.parse(text) : null;
  } catch { return result; }
}

const rand = Math.floor(Math.random() * 100000);
const email = `mcp${rand}@postiz.local`;
const PASSWORD = 'McpTest123!';

// ---------- 1. register + session + api key ----------
console.log('== REGISTER + API KEY ==');
let r = await api('POST', '/auth/register', { body: { provider: 'LOCAL', email, password: PASSWORD, company: 'MCP Co' }, accept: 'application/json' });
const cookie = (r.setCookie.find((c) => c.startsWith('auth=')) || '').split(';')[0];
r = await api('GET', '/user/self', { cookie });
const orgId = r.json?.orgId;
check('register + session', !!orgId, `status ${r.status}`);

r = await api('POST', '/user/api-key/rotate', { cookie });
let apiKey = r.json?.apiKey || r.json?.key || '';
if (!apiKey) console.log('  rotate payload:', r.text.slice(0, 200));
check('org api key rotated', !!apiKey, r.text.slice(0, 120));

// ---------- 2. inject mock wordpress channel ----------
console.log('== MOCK CHANNEL ==');
const prismaScript = `
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const integration = await p.integration.create({
    data: {
      internalId: 'mcpwp_${rand}',
      organizationId: '${orgId}',
      name: 'Mock WordPress (mcp)',
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
  console.log(String(e.stderr || e.message || '').slice(0, 200));
}
check('mock wordpress integration created', !!integrationId, integrationId);

// ---------- 3. MCP over /mcp (bearer = api key) ----------
console.log('== MCP STREAMABLE /mcp ==');
r = await api('POST', '/mcp', {
  apiKey,
  body: rpc('initialize', {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'freebuff-e2e', version: '1.0.0' },
  }),
});
const sessionId = r.sessionId;
check('initialize', r.status === 200 && !!r.json?.result?.serverInfo, `status ${r.status} ${r.text.slice(0, 120)}`);
check('server is Postiz MCP', r.json?.result?.serverInfo?.name === 'Postiz MCP', JSON.stringify(r.json?.result?.serverInfo));

await api('POST', '/mcp', { apiKey, sessionId, body: rpc('notifications/initialized', undefined, true) });

r = await api('POST', '/mcp', { apiKey, sessionId, body: rpc('tools/list', {}) });
const toolNames = (r.json?.result?.tools || []).map((t) => t.name);
check('tools/list works', r.status === 200 && toolNames.length > 0, `status ${r.status}, ${toolNames.length} tools`);
check('tools/list exposes integrationAnalyticsTool', toolNames.includes('integrationAnalyticsTool'), toolNames.join(','));
check('tools/list exposes postAnalyticsTool', toolNames.includes('postAnalyticsTool'), '');

console.log('== MCP tools/call ==');
// Channel analytics: wordpress is an article channel -> provider has no
// analytics -> empty array (not an error).
r = await api('POST', '/mcp', { apiKey, sessionId, body: rpc('tools/call', {
  name: 'integrationAnalyticsTool',
  arguments: { integrationId, days: 7 },
}) });
let out = unwrap(r.json?.result);
check('integrationAnalyticsTool returns empty analytics for article channel', !!out && Array.isArray(out.analytics) && out.analytics.length === 0, JSON.stringify(out).slice(0, 160));

// Post analytics: unknown post id -> empty array.
r = await api('POST', '/mcp', { apiKey, sessionId, body: rpc('tools/call', {
  name: 'postAnalyticsTool',
  arguments: { postId: 'nonexistent-post-id', days: 7 },
}) });
out = unwrap(r.json?.result);
check('postAnalyticsTool returns empty analytics for unknown post', !!out && Array.isArray(out.analytics) && out.analytics.length === 0, JSON.stringify(out).slice(0, 160));

// Error path: invalid integration id -> errors payload.
r = await api('POST', '/mcp', { apiKey, sessionId, body: rpc('tools/call', {
  name: 'integrationAnalyticsTool',
  arguments: { integrationId: 'does-not-exist', days: 7 },
}) });
out = unwrap(r.json?.result);
check('integrationAnalyticsTool reports error for invalid channel', !!out && typeof out.errors === 'string' && out.errors.length > 0, JSON.stringify(out).slice(0, 160));

// Negative auth: bad bearer must be rejected.
r = await api('POST', '/mcp', { apiKey: 'totally-invalid-key', body: rpc('tools/list', {}) });
check('invalid bearer rejected on /mcp', r.status === 401, `status ${r.status}`);

// ---------- 4. /mcp/:id transport (api key in path) ----------
console.log('== MCP /mcp/:id TRANSPORT ==');
r = await api('POST', `/mcp/${apiKey}`, {
  body: rpc('initialize', {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'freebuff-e2e', version: '1.0.0' },
  }),
});
check('/mcp/:id initialize', r.status === 200 && !!r.json?.result?.serverInfo, `status ${r.status}`);
r = await api('POST', `/mcp/${apiKey}`, { body: rpc('tools/list', {}) });
const toolNames2 = (r.json?.result?.tools || []).map((t) => t.name);
check('/mcp/:id tools/list includes analytics tools', toolNames2.includes('integrationAnalyticsTool') && toolNames2.includes('postAnalyticsTool'), `status ${r.status}, ${toolNames2.length} tools`);
r = await api('POST', '/mcp/invalid-key-in-path', { body: rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'x', version: '1' } }) });
check('/mcp/:id invalid key rejected', r.status === 400, `status ${r.status}`);

// ---------- 5. write tools: reschedule + cancel ----------
console.log('== MCP WRITE TOOLS (postDateTool / postStatusTool) ==');
// A scheduled post created through the REST API, exactly like the dashboard sends.
const futureDate = new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString();
r = await api('POST', '/posts', { cookie, body: {
  type: 'schedule',
  shortLink: false,
  date: futureDate,
  tags: [],
  posts: [{
    integration: { id: integrationId },
    value: [{ content: '<p>MCP write-tools test post</p>', image: [] }],
    settings: { __type: 'wordpress', title: 'MCP Write Tools', type: 'posts', status: 'publish' },
  }],
}});
const postId = r.json?.[0]?.postId;
check('scheduled post created via REST', !!postId, `status ${r.status} ${JSON.stringify(r.json).slice(0, 120)}`);

// 5a. postDateTool with the default action=update: date moves, state stays QUEUE.
const newDate = new Date(Date.now() + 6 * 24 * 3600 * 1000);
r = await api('POST', '/mcp', { apiKey, sessionId, body: rpc('tools/call', {
  name: 'postDateTool',
  arguments: { id: postId, date: newDate.toISOString() },
}) });
out = unwrap(r.json?.result);
check('postDateTool reschedules with update action', !!out && out.postId === postId && out.state === 'QUEUE' && out.publishDate === newDate.toISOString().slice(0, 19), JSON.stringify(out).slice(0, 160));
r = await api('GET', `/posts/${postId}`, { cookie });
check('new date persisted in DB', JSON.stringify(r.json || {}).includes(newDate.toISOString().slice(0, 16)), '');

// 5b. postStatusTool draft: cancels the scheduled post (QUEUE -> DRAFT).
r = await api('POST', '/mcp', { apiKey, sessionId, body: rpc('tools/call', {
  name: 'postStatusTool',
  arguments: { id: postId, status: 'draft' },
}) });
out = unwrap(r.json?.result);
check('postStatusTool cancels to draft', !!out && out.postId === postId && out.state === 'DRAFT', JSON.stringify(out).slice(0, 160));
r = await api('GET', `/posts/${postId}`, { cookie });
check('draft state persisted', r.json?.posts?.[0]?.state === 'DRAFT', JSON.stringify(r.json?.posts?.[0]?.state));

// 5c. postStatusTool schedule: queue the draft again (DRAFT -> QUEUE).
r = await api('POST', '/mcp', { apiKey, sessionId, body: rpc('tools/call', {
  name: 'postStatusTool',
  arguments: { id: postId, status: 'schedule' },
}) });
out = unwrap(r.json?.result);
check('postStatusTool queues draft again', !!out && out.state === 'QUEUE', JSON.stringify(out).slice(0, 160));

// 5d. Error path: unknown post id.
r = await api('POST', '/mcp', { apiKey, sessionId, body: rpc('tools/call', {
  name: 'postDateTool',
  arguments: { id: 'no-such-post', date: newDate.toISOString() },
}) });
out = unwrap(r.json?.result);
check('postDateTool reports error for unknown post', !!out && typeof out.errors === 'string' && out.errors.length > 0, JSON.stringify(out).slice(0, 160));

// ---------- 6. planning tools: free slot + media library ----------
console.log('== MCP PLANNING TOOLS (freeDateTimeTool / mediaListTool) ==');
// 6a. free slot for the organization
r = await api('POST', '/mcp', { apiKey, sessionId, body: rpc('tools/call', {
  name: 'freeDateTimeTool',
  arguments: {},
}) });
out = unwrap(r.json?.result);
check('freeDateTimeTool returns a UTC slot', !!out && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(out.date), JSON.stringify(out).slice(0, 160));
const freeSlot = out?.date || '';

// 6b. free slot for the specific channel
r = await api('POST', '/mcp', { apiKey, sessionId, body: rpc('tools/call', {
  name: 'freeDateTimeTool',
  arguments: { integrationId },
}) });
out = unwrap(r.json?.result);
check('freeDateTimeTool works per channel', !!out && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(out.date), JSON.stringify(out).slice(0, 160));

// 6c. media library starts empty
r = await api('POST', '/mcp', { apiKey, sessionId, body: rpc('tools/call', {
  name: 'mediaListTool',
  arguments: {},
}) });
out = unwrap(r.json?.result);
check('mediaListTool lists empty library', !!out && out.pages === 0 && Array.isArray(out.media) && out.media.length === 0, JSON.stringify(out).slice(0, 160));

// Seed one real image through the same upload path the dashboard uses.
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const form = new FormData();
form.append('file', new Blob([png], { type: 'image/png' }), `mcp-e2e-${rand}.png`);
const upRes = await fetch(BASE + '/media/upload-simple', {
  method: 'POST',
  headers: { cookie, 'authorization': `Bearer ${apiKey}` },
  body: form,
  signal: AbortSignal.timeout(30000),
});
const upJson = await upRes.json().catch(() => null);
check('media upload seeds the library', upRes.status === 200 || upRes.status === 201, `status ${upRes.status} ${JSON.stringify(upJson).slice(0, 120)}`);
const mediaPath = upJson?.path || '';

// 6d. mediaListTool finds it, with the path usable as an attachment
r = await api('POST', '/mcp', { apiKey, sessionId, body: rpc('tools/call', {
  name: 'mediaListTool',
  arguments: {},
}) });
out = unwrap(r.json?.result);
check('mediaListTool returns the uploaded item', !!out && Array.isArray(out.media) && out.media.some((m) => m.path === mediaPath), JSON.stringify(out).slice(0, 200));

// 6e. search filters by name
r = await api('POST', '/mcp', { apiKey, sessionId, body: rpc('tools/call', {
  name: 'mediaListTool',
  arguments: { search: `mcp-e2e-${rand}` },
}) });
out = unwrap(r.json?.result);
check('mediaListTool search finds by name', !!out && out.media?.length === 1, JSON.stringify(out).slice(0, 160));
r = await api('POST', '/mcp', { apiKey, sessionId, body: rpc('tools/call', {
  name: 'mediaListTool',
  arguments: { search: 'no-such-file-xyz' },
}) });
out = unwrap(r.json?.result);
check('mediaListTool search misses cleanly', !!out && out.media?.length === 0, JSON.stringify(out).slice(0, 160));

// 6f. full agentic loop: free slot + library media -> scheduled post
console.log('== AGENTIC LOOP (slot + media -> schedule) ==');
// Like a real agent: without the provider settings (an agent would get them
// from the integration schema tool first) the schedule must be refused with
// a clear validation message.
r = await api('POST', '/mcp', { apiKey, sessionId, body: rpc('tools/call', {
  name: 'integrationSchedulePostTool',
  arguments: {
    socialPost: [{
      integrationId,
      isPremium: false,
      date: freeSlot,
      shortLink: false,
      type: 'schedule',
      postsAndComments: [{
        content: '<p>Agentic loop post with library media</p>',
        attachments: [mediaPath],
      }],
      settings: [],
    }],
  },
}) });
out = unwrap(r.json?.result);
check('schedule without settings refused with validation errors', !!out?.errors && out.errors.includes('title'), JSON.stringify(out).slice(0, 200));

// With the provider settings (title/type/status for wordpress) it goes through.
r = await api('POST', '/mcp', { apiKey, sessionId, body: rpc('tools/call', {
  name: 'integrationSchedulePostTool',
  arguments: {
    socialPost: [{
      integrationId,
      isPremium: false,
      date: freeSlot,
      shortLink: false,
      type: 'schedule',
      postsAndComments: [{
        content: '<p>Agentic loop post with library media</p>',
        attachments: [mediaPath],
      }],
      settings: [
        { key: 'title', value: 'MCP Agentic Loop' },
        { key: 'type', value: 'posts' },
        { key: 'status', value: 'publish' },
      ],
    }],
  },
}) });
out = unwrap(r.json?.result);
const loopPostId = Array.isArray(out) ? out[0]?.postId : '';
check('schedulePostTool schedules with slot + library media', Array.isArray(out) && !!loopPostId, JSON.stringify(out).slice(0, 200));

// The scheduled post shows up in postsListTool (attachments are not part of
// its output - verify the media on the REST post detail instead).
r = await api('POST', '/mcp', { apiKey, sessionId, body: rpc('tools/call', {
  name: 'postsListTool',
  arguments: { startDate: new Date().toISOString().slice(0, 19), endDate: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().slice(0, 19) },
}) });
out = unwrap(r.json?.result);
const loopPost = (out?.posts || []).find((p) => p.id === loopPostId);
check('scheduled agentic post visible via postsListTool', !!loopPost && ['QUEUE', 'PUBLISHED'].includes(loopPost.state), JSON.stringify(loopPost).slice(0, 200));

// The library media is attached to the post (value[].image[].path).
r = await api('GET', `/posts/${loopPostId}`, { cookie });
check('library media attached to the scheduled post', JSON.stringify(r.json || {}).includes(mediaPath), JSON.stringify(r.json).slice(0, 160));

// TZ round-trip: the Z-less slot must land in the DB as the SAME instant
// (server TZ is UTC+3, so a local-time parse would shift it 3h early).
const storedDate = r.json?.posts?.[0]?.publishDate || r.json?.publishDate || '';
check('Z-less slot stored as the same UTC instant', storedDate === `${freeSlot}Z` || new Date(storedDate).toISOString() === new Date(`${freeSlot}Z`).toISOString(), `slot ${freeSlot}Z -> stored ${storedDate}`);

// ---------- 7. content edit tool (postContentTool) ----------
console.log('== MCP CONTENT EDIT (postContentTool) ==');
// guards first: unknown post, then the PUBLISHED post from section 5
r = await api('POST', '/mcp', { apiKey, sessionId, body: rpc('tools/call', {
  name: 'postContentTool',
  arguments: { id: 'no-such-post', content: ['<p>x</p>'] },
}) });
out = unwrap(r.json?.result);
check('content edit reports unknown post', !!out?.errors && out.errors.includes('not found'), JSON.stringify(out).slice(0, 160));

// The section-5 post is QUEUE again after the re-queue test - flip it to
// PUBLISHED via Prisma so the wrong-state guard is actually exercised.
fs.writeFileSync('.freebuff/tmp-publish-post.cjs', `
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  await p.post.update({ where: { id: '${postId}' }, data: { state: 'PUBLISHED' } });
  console.log('OK');
  await p.$disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
`);
try { execSync('node .freebuff/tmp-publish-post.cjs', { encoding: 'utf8', timeout: 60000 }); } catch (e) { console.log('publish-flip failed:', String(e.message).slice(0, 120)); }
r = await api('POST', '/mcp', { apiKey, sessionId, body: rpc('tools/call', {
  name: 'postContentTool',
  arguments: { id: postId, content: ['<p>x</p>'] },
}) });
out = unwrap(r.json?.result);
check('content edit refuses wrong-state post', !!out?.errors && out.errors.includes('edited'), JSON.stringify(out).slice(0, 160));

// happy path on the section-6 agentic post (still scheduled in the future)
const editDate = loopPost?.publishDate || '';
r = await api('POST', '/mcp', { apiKey, sessionId, body: rpc('tools/call', {
  name: 'postContentTool',
  arguments: { id: loopPostId, content: ['<p>Edited by postContentTool</p>'], attachments: [] },
}) });
out = unwrap(r.json?.result);
check('content edit applies (state + date preserved)', !!out && out.postId === loopPostId && ['QUEUE', 'PUBLISHED'].includes(out.state) && (!editDate || out.publishDate === editDate), JSON.stringify(out).slice(0, 200));

// text changed in DB, attachments cleared
r = await api('GET', `/posts/${loopPostId}`, { cookie });
const detail = r.json || {};
check('edited text persisted', JSON.stringify(detail).includes('Edited by postContentTool'), JSON.stringify(detail).slice(0, 120));
check('attachments replaced with []', !JSON.stringify(detail).includes(mediaPath), '');

// media back on (swap from the library), text kept
r = await api('POST', '/mcp', { apiKey, sessionId, body: rpc('tools/call', {
  name: 'postContentTool',
  arguments: { id: loopPostId, attachments: [mediaPath] },
}) });
out = unwrap(r.json?.result);
check('media-only edit keeps text and re-attaches', !!out && !out.errors, JSON.stringify(out).slice(0, 160));
r = await api('GET', `/posts/${loopPostId}`, { cookie });
const detail2 = JSON.stringify(r.json || {});
check('media re-attached and text kept', detail2.includes(mediaPath) && detail2.includes('Edited by postContentTool'), detail2.slice(0, 160));

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
