// Round 15 / F23 — ANNOTATIONS AUDIT: every catalog tool must carry a
// semantically correct MCP annotations block (title + the four hints), and
// the hints must match what the tool actually does. Hint semantics follow
// the MCP spec:
//   readOnlyHint    - the tool does not mutate its world when it succeeds
//   destructiveHint - a successful call may be irreversible for data the
//                     user produced (independent of readOnly)
//   idempotentHint  - repeating the same call leaves the same state
//   openWorldHint   - the tool reaches entities outside this organization
// Plus F22 doc-alignment probes: a doomed call must be refused with
// actionable output.errors BEFORE the confirmation dialog (pre-flight
// ordering, round-8 convention) on ALL five mutating post tools.
// Prereqs: rebuilt backend on :3000, docker stack up, mock-wp-server :4789.
// Run: node .freebuff/mcp-annotations-test.mjs
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

// ---------- setup: fresh org + mock channel ----------
const reg = await fetch(BASE + '/auth/register', {
  method: 'POST',
  headers: { 'content-type': 'application/json', accept: 'application/json' },
  body: JSON.stringify({ provider: 'LOCAL', email: `annot${rand}@postiz.local`, password: 'AnnotTest123!', company: 'Annot Co' }),
});
const authCookie = ((reg.headers.getSetCookie?.() || []).find((c) => c.startsWith('auth=')) || '').split(';')[0];
const orgId = (await (await fetch(BASE + '/user/self', { headers: { cookie: authCookie } })).json())?.orgId;
const apiKey = (await (await fetch(BASE + '/user/api-key/rotate', { method: 'POST', headers: { cookie: authCookie } })).json())?.apiKey || '';
check('setup: fresh org + key', !!orgId && !!apiKey);

fs.writeFileSync('.freebuff/tmp-annot-integration.cjs', `
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const integration = await p.integration.create({
    data: {
      internalId: 'annotwp_${rand}',
      organizationId: '${orgId}',
      name: 'Mock WP (annotations)',
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
  const out = execSync('node .freebuff/tmp-annot-integration.cjs', { encoding: 'utf8', timeout: 60000 });
  integrationId = (out.match(/INTEGRATION_ID=(\S+)/) || [])[1] || '';
} catch (e) { console.log(String(e.stderr || e.message || '').slice(0, 140)); }
check('setup: mock wordpress integration', !!integrationId);

// ---------- A. catalog invariants ----------
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
const byName = Object.fromEntries(catalog.map((x) => [x.name, x]));
// 27 registered tools minus the generated ask_postiz catch-all removed in
// F24 = 24 tools, every one annotated (F23 invariant).
check('catalog read (24 tools, uniform annotations)', catalog.length === 24, String(catalog.length));

console.log('== A. ANNOTATIONS ON THE CATALOG ==');
const missing = catalog.filter((t) => {
  const a = t.annotations || (t.mcp && t.mcp.annotations);
  return !a || typeof a.readOnlyHint !== 'boolean' || typeof a.destructiveHint !== 'boolean'
    || typeof a.idempotentHint !== 'boolean' || typeof a.openWorldHint !== 'boolean' || !a.title;
});
check('every tool has title + 4 boolean hints', missing.length === 0, missing.map((m) => m.name).join(',').slice(0, 200));

const ann = (n) => byName[n]?.annotations || byName[n]?.mcp?.annotations || {};
// The 10 pure read tools (per-tool semantics audited against the code).
// NOTE: the three discovery tools keep unsuffixed catalog ids
// (integrationList / groupList / integrationSchema) - historical naming.
const readTools = ['integrationList', 'groupList', 'integrationSchema', 'postsListTool', 'postDetailsTool',
  'freeDateTimeTool', 'mediaListTool', 'integrationAnalyticsTool', 'postAnalyticsTool', 'videoStatusTool'];
// The 6 tools whose success mutates user data irreversibly-ish. postSettingsTool
// is deliberately non-destructive: settings are a reversible merge (pass []
// or the old values to restore), unlike postContent (media replace) or
// postStatus (state transitions).
const destructiveTools = ['integrationSchedulePostTool', 'postContentTool',
  'postDateTool', 'postStatusTool', 'triggerTool'];
const roBad = readTools.filter((n) => !byName[n] || ann(n).readOnlyHint !== true || ann(n).destructiveHint !== false);
check('pure-read tools flagged readOnly+non-destructive', roBad.length === 0, roBad.join(','));
const dBad = destructiveTools.filter((n) => !byName[n] || ann(n).readOnlyHint !== false || ann(n).destructiveHint !== true);
check('mutating tools flagged non-readOnly+destructive', dBad.length === 0, dBad.join(','));
check('postSettingsTool: write but reversible (non-destructive)', ann('postSettingsTool').readOnlyHint === false && ann('postSettingsTool').destructiveHint === false, JSON.stringify(ann('postSettingsTool')).slice(0, 120));
// Uniformity: every catalog tool annotated + NO generated agent catch-all
// (agents registered on the MCPServer leak as annotation-less ask_<agent> tools).
const noAnnotations = catalog.filter((t) => !(t.annotations || (t.mcp && t.mcp.annotations)));
check('zero annotation-less tools in the catalog', noAnnotations.length === 0, noAnnotations.map((m) => m.name).join(','));
const agentLeaks = catalog.filter((t) => /^ask_/.test(t.name));
check('no generated ask_<agent> catch-all tool', agentLeaks.length === 0, agentLeaks.map((m) => m.name).join(','));
const runLeaks = catalog.filter((t) => /^run_/.test(t.name));
check('no generated run_<workflow> tools', runLeaks.length === 0, runLeaks.map((m) => m.name).join(','));
const incoherent = catalog.filter((t) => {
  const a = ann(t.name);
  return (a.readOnlyHint && a.destructiveHint) || (a.readOnlyHint && a.idempotentHint === false);
});
check('no readOnly tool claims destructive or non-idempotent', incoherent.length === 0, incoherent.map((m) => m.name).join(','));

// ---------- fixtures: a scheduled single post + a thread + a past-QUEUE post ----------
const tomorrow = new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 19);
const wpSettings = [
  { key: 'title', value: `Annot ${rand}` },
  { key: 'type', value: 'posts' },
  { key: 'status', value: 'publish' },
];
async function scheduleOne(date, type, withComment) {
  const pac = [{ content: `<p>annot main ${rand}</p>`, attachments: [] }];
  if (withComment) pac.push({ content: `<p>annot reply ${rand}</p>`, attachments: [] });
  let raw = await callToolRaw('integrationSchedulePostTool', {
    socialPost: [{ integrationId, isPremium: false, date, shortLink: false, type, postsAndComments: pac, settings: wpSettings }],
  });
  if (raw?.resultType === 'input_required') {
    const k = Object.keys(raw.inputRequests)[0];
    raw = await callToolRaw('integrationSchedulePostTool', {
      socialPost: [{ integrationId, isPremium: false, date, shortLink: false, type, postsAndComments: pac, settings: wpSettings }],
    }, { inputResponses: { [k]: { action: 'accept', content: { confirm: true } } } });
  }
  const out = unwrap(raw);
  return Array.isArray(out) ? out[0]?.postId : out?.created?.[0]?.postId || null;
}
const postId = await scheduleOne(tomorrow, 'schedule', false);
check('fixture: scheduled post', !!postId);
const threadId = await scheduleOne(tomorrow, 'schedule', true);
const details = await callTool('postDetailsTool', { id: threadId });
const commentId = details?.parts?.[1]?.id || '';
check('fixture: thread + comment id', !!commentId, JSON.stringify(details?.parts || {}).slice(0, 100));

// ---------- B. pre-flight ordering on ALL five mutating post tools ----------
// A doomed call must return output.errors with NO confirmation dialog
// (raw.resultType !== 'input_required'). This is the F18/F22 contract.
console.log('== B. DOOMED CALLS NEVER OPEN THE DIALOG ==');
const doom = async (name, args, label, re) => {
  const raw = await callToolRaw(name, args);
  const out = unwrap(raw);
  check(`${label}: refused with errors, no dialog`,
    raw?.resultType !== 'input_required' && typeof out?.errors === 'string' && re.test(out.errors),
    JSON.stringify(out || raw || {}).slice(0, 140));
};
await doom('postContentTool', { id: 'nosuch-' + rand, content: ['<p>x</p>'] }, 'postContent unknown id', /postsList|not found/i);
await doom('postSettingsTool', { id: 'nosuch-' + rand, settings: [{ key: 'title', value: 'x' }] }, 'postSettings unknown id', /postsList|not found/i);
await doom('postDateTool', { id: commentId, date: tomorrow, action: 'update' }, 'postDate comment id', /comment/i);
await doom('postStatusTool', { id: 'nosuch-' + rand, status: 'draft' }, 'postStatus unknown id', /postsList|not found/i);
await doom('integrationSchedulePostTool', { socialPost: [{ integrationId: 'nosuch-' + rand, isPremium: false, date: tomorrow, shortLink: false, type: 'draft', postsAndComments: [{ content: '<p>x</p>', attachments: [] }], settings: [] }] }, 'schedule unknown channel', /integration/i);

// A past-QUEUE post must be refused by postContent (state/date pre-flight),
// with or without a dialog never opening.
console.log('== C. PAST-QUEUE POST IS UNEDITABLE ==');
const soon = new Date(Date.now() + 2 * 1000).toISOString().slice(0, 19);
const raceId = await scheduleOne(soon, 'schedule', false);
await new Promise((r) => setTimeout(r, 9000));
const pastRaw = await callToolRaw('postContentTool', { id: raceId, content: ['<p>too late</p>'] });
const pastOut = unwrap(pastRaw);
check('postContent refuses past-QUEUE post without dialog',
  pastRaw?.resultType !== 'input_required' && typeof pastOut?.errors === 'string' && /passed|published|not published yet|edit/i.test(pastOut.errors),
  JSON.stringify(pastOut || {}).slice(0, 140));

// ---------- D. happy paths still confirm + execute (guards not over-refusing) ----------
console.log('== D. HAPPY PATHS STILL WORK ==');
const settingsRaw1 = await callToolRaw('postSettingsTool', { id: postId, settings: [{ key: 'title', value: `Annot edited ${rand}` }] });
check('postSettings opens the dialog on a valid call', settingsRaw1?.resultType === 'input_required', JSON.stringify(settingsRaw1 || {}).slice(0, 120));
const sKey = settingsRaw1?.inputRequests ? Object.keys(settingsRaw1.inputRequests)[0] : '';
const settingsDeclined = unwrap(await callToolRaw('postSettingsTool', { id: postId, settings: [{ key: 'title', value: `Annot edited ${rand}` }] }, { inputResponses: { [sKey]: { action: 'decline' } } }));
check('postSettings decline returns errors, no change', typeof settingsDeclined?.errors === 'string' && /declin/i.test(settingsDeclined.errors), JSON.stringify(settingsDeclined).slice(0, 120));
const settingsAccepted = unwrap(await callToolRaw('postSettingsTool', { id: postId, settings: [{ key: 'title', value: `Annot edited ${rand}` }] }, { inputResponses: { [sKey]: { action: 'accept', content: { confirm: true } } } }));
check('postSettings accepted applies the change', !!settingsAccepted?.postId && !settingsAccepted?.errors, JSON.stringify(settingsAccepted).slice(0, 140));

const contentRaw1 = await callToolRaw('postContentTool', { id: postId, content: [`<p>annot content edit ${rand}</p>`] });
check('postContent opens the dialog on a valid call', contentRaw1?.resultType === 'input_required', JSON.stringify(contentRaw1 || {}).slice(0, 120));
const cKey = contentRaw1?.inputRequests ? Object.keys(contentRaw1.inputRequests)[0] : '';
const contentAccepted = unwrap(await callToolRaw('postContentTool', { id: postId, content: [`<p>annot content edit ${rand}</p>`] }, { inputResponses: { [cKey]: { action: 'accept', content: { confirm: true } } } }));
check('postContent accepted edits in place (state+date kept)',
  contentAccepted?.postId === postId && contentAccepted?.state === 'QUEUE' && !!contentAccepted?.publishDate,
  JSON.stringify(contentAccepted).slice(0, 140));

fs.unlinkSync('.freebuff/tmp-annot-integration.cjs');
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
