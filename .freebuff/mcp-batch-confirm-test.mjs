// Round 13 / F20 — PER-POST BATCH CONFIRMATION E2E.
// A multi-post write now shows ONE elicitation form with a checkbox per post
// (keep 18 of 20, drop 2). Pins: batch form shape, partial accept (created +
// declined indices in the result), decline-all, single-post compat, no-cap
// and legacy fail-open, oversized-batch fallback to the simple dialog.
//
// Prereqs: rebuilt backend :3000, mock-wp :4789.
// Run: node .freebuff/mcp-batch-confirm-test.mjs
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

async function api(method, path, { body, apiKey, extraHeaders } = {}) {
  const headers = { ...(extraHeaders || {}) };
  if (body) headers['content-type'] = 'application/json';
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
async function callModern(name, args, { caps = { elicitation: {} }, inputResponses } = {}) {
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

// ---------- setup ----------
const reg = await fetch(BASE + '/auth/register', {
  method: 'POST',
  headers: { 'content-type': 'application/json', accept: 'application/json' },
  body: JSON.stringify({ provider: 'LOCAL', email: `batch${rand}@postiz.local`, password: 'BatchTest123!', company: 'Batch Co' }),
});
const authCookie = ((reg.headers.getSetCookie?.() || []).find((c) => c.startsWith('auth=')) || '').split(';')[0];
const orgId = (await (await fetch(BASE + '/user/self', { headers: { cookie: authCookie } })).json())?.orgId;
const apiKey = (await (await fetch(BASE + '/user/api-key/rotate', { method: 'POST', headers: { cookie: authCookie } })).json())?.apiKey || '';
check('setup: user + key', !!orgId && !!apiKey);

fs.writeFileSync('.freebuff/tmp-batch-integration.cjs', `
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const integration = await p.integration.create({
    data: {
      internalId: 'batchwp_${rand}',
      organizationId: '${orgId}',
      name: 'Mock WP (batch)',
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
  const out = execSync('node .freebuff/tmp-batch-integration.cjs', { encoding: 'utf8', timeout: 60000 });
  integrationId = (out.match(/INTEGRATION_ID=(\S+)/) || [])[1] || '';
} catch (e) { console.log(String(e.stderr || e.message || '').slice(0, 160)); }
check('setup: mock wordpress integration', !!integrationId);

const threePosts = [0, 1, 2].map((i) => ({
  integrationId, isPremium: false,
  date: new Date(Date.now() + (i + 1) * 24 * 3600 * 1000).toISOString().slice(0, 19),
  shortLink: false, type: 'draft',
  postsAndComments: [{ content: `<p>batch item ${rand} #${i}</p>`, attachments: [] }],
  settings: [],
}));

// ============ 1. BATCH FORM SHAPE ============
console.log('== 1. BATCH FORM (3 posts -> one dialog, checkbox per post) ==');
const r1 = await callModern('integrationSchedulePostTool', { socialPost: threePosts });
check('round1 is input_required', r1?.resultType === 'input_required', JSON.stringify(r1 || {}).slice(0, 140));
const key = r1?.inputRequests ? Object.keys(r1.inputRequests)[0] : '';
const form = r1?.inputRequests?.[key]?.params?.requestedSchema;
const propNames = Object.keys(form?.properties || {});
check('form has one checkbox per post (post_0..post_2)', propNames.join(',') === 'post_0,post_1,post_2', propNames.join(','));
check('checkbox descriptions carry the post previews', /batch item/.test(form?.properties?.post_1?.description || ''), String(form?.properties?.post_1?.description).slice(0, 80));
check('message says Schedule N posts', /Schedule 3 posts/.test(r1?.inputRequests?.[key]?.params?.message || ''), String(r1?.inputRequests?.[key]?.params?.message).slice(0, 80));

// ============ 2. PARTIAL ACCEPT ============
console.log('== 2. PARTIAL ACCEPT (keep 0 and 2, drop 1) ==');
const partial = await callModern('integrationSchedulePostTool', { socialPost: threePosts }, {
  inputResponses: { [key]: { action: 'accept', content: { posts: [true, false, true] } } },
});
const partialOut = unwrap(partial);
check('partial accept reports errors + created + declined', typeof partialOut?.errors === 'string' && Array.isArray(partialOut?.created) && Array.isArray(partialOut?.declined), JSON.stringify(partialOut || {}).slice(0, 160));
check('exactly 2 posts created', partialOut?.created?.length === 2, String(partialOut?.created?.length));
check('declined carries the dropped index [1]', JSON.stringify(partialOut?.declined) === '[1]', JSON.stringify(partialOut?.declined));
check('errors mention the uncheck count', /unchecked 1 of 3/.test(partialOut?.errors || ''), String(partialOut?.errors).slice(0, 120));

const win = { startDate: new Date(Date.now() - 3600 * 1000).toISOString().slice(0, 19), endDate: new Date(Date.now() + 5 * 24 * 3600 * 1000).toISOString().slice(0, 19) };
const listed = unwrap(await callModern('postsListTool', { ...win, state: 'draft', page: 1 }));
check('DB shows exactly 2 new drafts (nothing else created)', listed?.total === 2, `total ${listed?.total}`);

// ============ 3. DECLINE ALL VIA ACTION ============
console.log('== 3. DECLINE ALL ==');
const d1 = await callModern('integrationSchedulePostTool', { socialPost: threePosts });
const dKey = d1?.inputRequests ? Object.keys(d1.inputRequests)[0] : '';
const declined = unwrap(await callModern('integrationSchedulePostTool', { socialPost: threePosts }, {
  inputResponses: { [dKey]: { action: 'decline' } },
}));
check('decline-all -> errors, no created', typeof declined?.errors === 'string' && Array.isArray(declined?.created) && declined.created.length === 0, JSON.stringify(declined || {}).slice(0, 120));
const listed2 = unwrap(await callModern('postsListTool', { ...win, state: 'draft', page: 1 }));
check('DB unchanged after decline-all', listed2?.total === 2, `total ${listed2?.total}`);

// ============ 4. ACCEPT WITH EMPTY CONTENT = ALL ============
console.log('== 4. ACCEPT WITH MALFORMED CONTENT ==');
const m1 = await callModern('integrationSchedulePostTool', { socialPost: threePosts });
const mKey = m1?.inputRequests ? Object.keys(m1.inputRequests)[0] : '';
const malformed = unwrap(await callModern('integrationSchedulePostTool', { socialPost: threePosts }, {
  inputResponses: { [mKey]: { action: 'accept', content: {} } },
}));
check('accept with empty content -> creates all 3 (documented)', Array.isArray(malformed) && malformed.length === 3, JSON.stringify(malformed || malformed || {}).slice(0, 120));

// ============ 5. SINGLE POST KEEPS SIMPLE DIALOG ============
console.log('== 5. SINGLE POST COMPAT ==');
const single = [threePosts[0]];
const s1 = await callModern('integrationSchedulePostTool', { socialPost: single });
const sKey = s1?.inputRequests ? Object.keys(s1.inputRequests)[0] : '';
const sForm = s1?.inputRequests?.[sKey]?.params?.requestedSchema;
check('single post form has the boolean confirm (no post_ keys)', !!sForm?.properties?.confirm && !sForm?.properties?.post_0, JSON.stringify(Object.keys(sForm?.properties || {})));
const sOut = unwrap(await callModern('integrationSchedulePostTool', { socialPost: single }, {
  inputResponses: { [sKey]: { action: 'accept', content: { confirm: true } } },
}));
check('single post accept -> array result (old shape)', Array.isArray(sOut) && !!sOut[0]?.postId, JSON.stringify(sOut || {}).slice(0, 100));

// ============ 6. FAIL-OPEN PATHS ============
console.log('== 6. FAIL-OPEN (no cap, legacy) ==');
const noCap = await callModern('integrationSchedulePostTool', { socialPost: threePosts }, { caps: {} });
check('modern without elicitation cap: 3 posts, no dialog', Array.isArray(unwrap(noCap)) && unwrap(noCap).length === 3, JSON.stringify(unwrap(noCap) || noCap || {}).slice(0, 100));

const li = await api('POST', '/mcp', {
  apiKey,
  body: { jsonrpc: '2.0', id: ++idc, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'batch-legacy', version: '1' } } },
});
const legacySid = li.sessionId || '';
await api('POST', '/mcp', { apiKey, sessionId: legacySid, body: { jsonrpc: '2.0', method: 'notifications/initialized' } });
const legacyCall = await api('POST', '/mcp', {
  apiKey, sessionId: legacySid,
  body: { jsonrpc: '2.0', id: ++idc, method: 'tools/call', params: { name: 'integrationSchedulePostTool', arguments: { socialPost: threePosts } } },
});
const legacyOut = unwrap(legacyCall.json?.result ?? null);
check('legacy era: 3 posts execute without any dialog', Array.isArray(legacyOut) && legacyOut.length === 3, JSON.stringify(legacyOut || legacyCall.json || {}).slice(0, 100));

// ============ 7. OVERSIZED BATCH FALLS BACK TO SIMPLE DIALOG ============
console.log('== 7. 26-POST BATCH FALLBACK ==');
const bigPosts = Array.from({ length: 26 }, (_, i) => ({
  ...threePosts[0],
  date: new Date(Date.now() + (i + 10) * 24 * 3600 * 1000).toISOString().slice(0, 19),
  postsAndComments: [{ content: `<p>big batch ${rand} #${i}</p>`, attachments: [] }],
}));
const b1 = await callModern('integrationSchedulePostTool', { socialPost: bigPosts });
const bKey = b1?.inputRequests ? Object.keys(b1.inputRequests)[0] : '';
const bForm = b1?.inputRequests?.[bKey]?.params?.requestedSchema;
check('26 posts -> simple confirm dialog (no 26 checkboxes)', !!bForm?.properties?.confirm && !bForm?.properties?.post_25, JSON.stringify(Object.keys(bForm?.properties || {}).slice(0, 6)));
check('fallback dialog mentions the count', /26 .*post\(s\)/.test(b1?.inputRequests?.[bKey]?.params?.message || ''), String(b1?.inputRequests?.[bKey]?.params?.message).slice(0, 80));
const bOut = unwrap(await callModern('integrationSchedulePostTool', { socialPost: bigPosts }, {
  inputResponses: { [bKey]: { action: 'decline' } },
}));
check('oversized decline-all -> nothing created', typeof bOut?.errors === 'string', JSON.stringify(bOut || {}).slice(0, 100));

fs.unlinkSync('.freebuff/tmp-batch-integration.cjs');
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
