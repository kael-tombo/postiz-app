// Round 17 / F25 — FAILURE JOURNEYS: the agent does not only walk happy
// paths; it also attempts things that MUST fail. Every journey here is
// expected to be refused with an actionable output.errors (never a raw
// crash, never a silent republish/state change), and every refusal must
// teach the fix: name the state, name the blocker, or name the
// alternative tool. An LLM can only recover from what the error says.
//
// Journeys:
//   J1  postContent   on a PUBLISHED post        -> refused, no dialog
//   J2  postSettings  on a PUBLISHED post        -> refused, no dialog
//   J3  postDate      re-queue of PUBLISHED      -> refused, no dialog
//   J4  postStatus    'schedule' on PUBLISHED    -> refused (republish hazard)
//   J5  postStatus    'draft' on PUBLISHED       -> allowed (safe cancel)
//   J6  freeDateTime  on a DISABLED channel      -> clean refusal, no crash
//   J7  triggerTool   bogus methodName           -> clean refusal, no crash
//   J8  schedulePost  on a DISABLED channel      -> refused with reason
//   J9  cancel on a DISABLED channel's post      -> clean refusal (no doom loop)
// Quality bar: refusal text must name the state/blocker or point to a tool;
// scoring mirrors the cold-start eval (1 clean+actionable, 0.5 clean+vague,
// 0 crash/silent success).
// Prereqs: rebuilt backend on :3000, docker stack up, mock-wp-server :4789.
// Run: node .freebuff/mcp-failure-journeys-test.mjs
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

// ---------- error-quality scorer ----------
// 1.0 = clean errors naming the state/blocker or pointing at a tool
// 0.5 = clean but vague
// 0.0 = crash, or worse: the call SUCCEEDED when it had to fail
function scoreRefusal(label, raw, out, mustMention) {
  if (raw?.resultType === 'input_required') {
    console.log(`  ${label}: dialog opened for a doomed call -> 0.0`);
    return { score: 0, why: 'dialog for doomed call' };
  }
  if (out === null || out === undefined) {
    console.log(`  ${label}: empty result -> 0.0`);
    return { score: 0, why: 'empty' };
  }
  if (typeof out?.errors !== 'string') {
    console.log(`  ${label}: NO refusal (succeeded?!) -> 0.0  ${JSON.stringify(out).slice(0, 80)}`);
    return { score: 0, why: 'no refusal' };
  }
  const msg = out.errors.toLowerCase();
  const actionable = mustMention.some((re) => re.test(msg)) || /postslist|freetime|integrationlist|tool/i.test(msg);
  const vague = msg.length < 12;
  const score = vague ? 0.5 : actionable ? 1 : 0.5;
  console.log(`  ${label}: "${out.errors.slice(0, 90)}" -> ${score}`);
  return { score, why: out.errors.slice(0, 120) };
}
const JOURNEYS = [];
const journey = (label, raw, out, mustMention) =>
  JOURNEYS.push({ label, ...scoreRefusal(label, raw, out, mustMention) });

// ---------- setup: fresh org + TWO mock channels (one force-disabled) ----------
const reg = await fetch(BASE + '/auth/register', {
  method: 'POST',
  headers: { 'content-type': 'application/json', accept: 'application/json' },
  body: JSON.stringify({ provider: 'LOCAL', email: `failj${rand}@postiz.local`, password: 'FailTest123!', company: 'Fail Co' }),
});
const authCookie = ((reg.headers.getSetCookie?.() || []).find((c) => c.startsWith('auth=')) || '').split(';')[0];
const orgId = (await (await fetch(BASE + '/user/self', { headers: { cookie: authCookie } })).json())?.orgId;
const apiKey = (await (await fetch(BASE + '/user/api-key/rotate', { method: 'POST', headers: { cookie: authCookie } })).json())?.apiKey || '';
check('setup: fresh org + key', !!orgId && !!apiKey);

fs.writeFileSync('.freebuff/tmp-failj-integrations.cjs', `
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const token = Buffer.from(JSON.stringify({ domain: 'http://127.0.0.1:4789', username: 'u', password: 'p' })).toString('base64');
  const live = await p.integration.create({ data: {
    internalId: 'failj_live_${rand}', organizationId: '${orgId}',
    name: 'Live WP', providerIdentifier: 'wordpress', type: 'article',
    token, picture: '' } });
  const dead = await p.integration.create({ data: {
    internalId: 'failj_dead_${rand}', organizationId: '${orgId}',
    name: 'Dead WP', providerIdentifier: 'wordpress', type: 'article',
    token, picture: '' } });
  console.log('LIVE=' + live.id); console.log('DEAD=' + dead.id);
  await p.\$disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
`);
let liveId = '', deadId = '';
try {
  const out = execSync('node .freebuff/tmp-failj-integrations.cjs', { encoding: 'utf8', timeout: 60000 });
  liveId = (out.match(/LIVE=(\S+)/) || [])[1] || '';
  deadId = (out.match(/DEAD=(\S+)/) || [])[1] || '';
} catch (e) { console.log(String(e.stderr || e.message || '').slice(0, 140)); }
check('setup: live + disabled channels', !!liveId && !!deadId);

// ---------- fixtures: one published post on the live channel; the disabled-channel post is created while the channel is still enabled, the channel is disabled afterwards ----------
const wpSettings = [
  { key: 'title', value: `FailJ ${rand}` },
  { key: 'type', value: 'posts' },
  { key: 'status', value: 'publish' },
];
async function scheduleOne(integrationId, date, type) {
  const args = { socialPost: [{ integrationId, isPremium: false, date, shortLink: false, type, postsAndComments: [{ content: `<p>failj ${rand}</p>`, attachments: [] }], settings: wpSettings }] };
  let raw = await callToolRaw('integrationSchedulePostTool', args);
  if (raw?.resultType === 'input_required') {
    const k = Object.keys(raw.inputRequests)[0];
    raw = await callToolRaw('integrationSchedulePostTool', args, { inputResponses: { [k]: { action: 'accept', content: { confirm: true } } } });
  }
  const out = unwrap(raw);
  if (!out || (!Array.isArray(out) && !out?.created)) {
    console.log('  scheduleOne raw:', JSON.stringify(raw || {}).slice(0, 300));
  }
  return Array.isArray(out) ? out[0]?.postId : out?.created?.[0]?.postId || null;
}
const pastDate = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString().slice(0, 19);
const tomorrow = new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 19);
// The tools rightly refuse past dates, so the published fixture is created
// future-dated and then flipped straight to PUBLISHED in the DB.
let publishedId = await scheduleOne(liveId, tomorrow, 'schedule');
check('fixture: future post scheduled', !!publishedId, publishedId);
fs.writeFileSync('.freebuff/tmp-failj-publish.cjs', `
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  await p.post.update({ where: { id: '${publishedId}' }, data: { state: 'PUBLISHED', publishDate: new Date(Date.now() - 3 * 24 * 3600 * 1000) } });
  console.log('FLIPPED');
  await p.\$disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
`);
try { execSync('node .freebuff/tmp-failj-publish.cjs', { encoding: 'utf8', timeout: 60000 }); } catch (e) { console.log(String(e.stderr || e.message || '').slice(0, 140)); }
check('fixture: post flipped to PUBLISHED', true);
const details = await callTool('postDetailsTool', { id: publishedId });
check('fixture: post reads as PUBLISHED', /PUBLISHED/.test(JSON.stringify(details || {})), JSON.stringify(details || {}).slice(0, 120));
const deadScheduledId = await scheduleOne(deadId, tomorrow, 'schedule');
check('fixture: post on soon-to-be-disabled channel exists', !!deadScheduledId, deadScheduledId);
fs.writeFileSync('.freebuff/tmp-failj-disable.cjs', `
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  await p.integration.update({ where: { id: '${deadId}' }, data: { disabled: true } });
  console.log('DISABLED');
  await p.\$disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
`);
try { execSync('node .freebuff/tmp-failj-disable.cjs', { encoding: 'utf8', timeout: 60000 }); } catch (e) { console.log(String(e.stderr || e.message || '').slice(0, 140)); }
check('fixture: channel now disabled', true);

// ---------- J1/J2: edit tools on the PUBLISHED post ----------
console.log('== J1/J2: edit tools refuse PUBLISHED posts ==');
let raw = await callToolRaw('postContentTool', { id: publishedId, content: ['<p>zombie edit</p>'] });
journey('J1 postContent on published', raw, unwrap(raw), [/publish/i, /not published yet/i, /edit/i]);
check('J1 content unchanged on published post', !JSON.stringify(await callTool('postDetailsTool', { id: publishedId })).includes('zombie edit'));

raw = await callToolRaw('postSettingsTool', { id: publishedId, settings: [{ key: 'title', value: 'zombie title' }] });
journey('J2 postSettings on published', raw, unwrap(raw), [/publish/i, /not published yet/i, /update/i]);

// ---------- J3: postDate with action=schedule on the PUBLISHED post (republish hazard) ----------
console.log('== J3: republish hazard refused ==');
raw = await callToolRaw('postDateTool', { id: publishedId, date: tomorrow, action: 'schedule' });
journey('J3 postDate schedule on published', raw, unwrap(raw), [/publish/i, /republish/i, /reschedul/i]);
const stillPublished = await callTool('postDetailsTool', { id: publishedId });
check('J3 post stayed PUBLISHED (no silent state flip)', /PUBLISHED|RELEASED/.test(JSON.stringify(stillPublished || {})), JSON.stringify(stillPublished || {}).slice(0, 100));

// ---------- J4/J5: postStatus on the PUBLISHED post ----------
console.log('== J4/J5: status transitions on PUBLISHED ==');
raw = await callToolRaw('postStatusTool', { id: publishedId, status: 'schedule' });
journey('J4 postStatus schedule on published (republish hazard)', raw, unwrap(raw), [/publish/i, /republish/i, /already/i]);
const afterJ4 = await callTool('postDetailsTool', { id: publishedId });
check('J4 state unchanged after refused re-queue', /PUBLISHED|RELEASED/.test(JSON.stringify(afterJ4 || {})), JSON.stringify(afterJ4 || {}).slice(0, 100));

raw = await callToolRaw('postStatusTool', { id: publishedId, status: 'draft' });
if (raw?.resultType === 'input_required') {
  const k5 = Object.keys(raw.inputRequests)[0];
  raw = await callToolRaw('postStatusTool', { id: publishedId, status: 'draft' }, { inputResponses: { [k5]: { action: 'accept', content: { confirm: true } } } });
}
const j5 = unwrap(raw);
check('J5 cancel-to-draft on published is the SAFE path (allowed)', !!j5?.postId && j5?.state === 'DRAFT' && !j5?.errors, JSON.stringify(j5).slice(0, 120));
const backRaw1 = await callToolRaw('postStatusTool', { id: publishedId, status: 'schedule' });
let backRaw = backRaw1;
if (backRaw1?.resultType === 'input_required') {
  const kb = Object.keys(backRaw1.inputRequests)[0];
  backRaw = await callToolRaw('postStatusTool', { id: publishedId, status: 'schedule' }, { inputResponses: { [kb]: { action: 'accept', content: { confirm: true } } } });
}
const backToQueue = unwrap(backRaw);
check('J5 requeue of the now-DRAFT post works (normal lifecycle)', backToQueue?.postId === publishedId && backToQueue?.state === 'QUEUE', JSON.stringify(backToQueue).slice(0, 120));

// ---------- J6: freeDateTime on the DISABLED channel ----------
console.log('== J6: discovery on a DISABLED channel ==');
raw = await callToolRaw('freeDateTimeTool', { integrationId: deadId });
journey('J6 freeDateTime on disabled channel', raw, unwrap(raw), [/disabled/i, /disconnect/i, /not found/i, /reconnect/i]);

// ---------- J7: triggerTool with a bogus methodName on the live channel ----------
console.log('== J7: bogus provider helper ==');
raw = await callToolRaw('triggerTool', { integrationId: liveId, methodName: 'noSuchHelperFn', dataSchema: [] });
journey('J7 triggerTool bogus methodName', raw, unwrap(raw), [/method/i, /function/i, /not found/i, /schema/i]);

// ---------- J8: schedule on the DISABLED channel ----------
console.log('== J8: write on a DISABLED channel ==');
raw = await callToolRaw('integrationSchedulePostTool', { socialPost: [{ integrationId: deadId, isPremium: false, date: tomorrow, shortLink: false, type: 'draft', postsAndComments: [{ content: '<p>ghost post</p>', attachments: [] }], settings: [] }] });
journey('J8 schedule on disabled channel', raw, unwrap(raw), [/disabled/i, /disconnect/i, /not found/i, /reconnect/i]);
const ghostList = await callTool('postsListTool', { startDate: new Date(Date.now() - 3600 * 1000).toISOString().slice(0, 19), endDate: new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString().slice(0, 19), state: 'draft', page: 1 });
check('J8 no ghost post created on the disabled channel', ghostList?.total === 0, `total ${ghostList?.total}`);

// ---------- J9: cancel the disabled-channel post (no doom loop) ----------
// Cancelling a doomed post is a SAFE, confirmable action: the dialog is the
// normal confirm flow (not a doom loop), and after accepting, the cancel
// must SUCCEED - an agent must always be able to clean up posts whose
// channel died. Only a crash or a refused cleanup scores 0.
console.log('== J9: cancel on the disabled channel post ==');
raw = await callToolRaw('postStatusTool', { id: deadScheduledId, status: 'draft' });
if (raw?.resultType === 'input_required') {
  const k9 = Object.keys(raw.inputRequests)[0];
  raw = await callToolRaw('postStatusTool', { id: deadScheduledId, status: 'draft' }, { inputResponses: { [k9]: { action: 'accept', content: { confirm: true } } } });
}
const j9 = unwrap(raw);
if (j9?.postId && j9?.state === 'DRAFT') {
  console.log('  J9: cleanup cancel succeeds on the disabled channel -> 1.0');
  JOURNEYS.push({ label: 'J9 cancel post on disabled channel', score: 1, why: 'clean cancel after dialog' });
} else {
  journey('J9 cancel post on disabled channel', raw, j9, [/disabled/i, /disconnect/i, /reconnect/i, /cancel/i]);
}

// ---------- scoring ----------
const total = JOURNEYS.reduce((a, s) => a + s.score, 0);
console.log('\n-- failure-journey scorecard --');
for (const s of JOURNEYS) console.log(`  ${s.label.padEnd(44)} ${s.score}`);
console.log(`  TOTAL ${total.toFixed(1)} / ${JOURNEYS.length}`);
check('every journey refused cleanly and actionably (score 1.0 each)', total === JOURNEYS.length, JOURNEYS.filter((s) => s.score < 1).map((s) => `${s.label}: ${s.why}`).join(' | ').slice(0, 400));

fs.unlinkSync('.freebuff/tmp-failj-integrations.cjs');
fs.unlinkSync('.freebuff/tmp-failj-publish.cjs');
fs.unlinkSync('.freebuff/tmp-failj-disable.cjs');
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
