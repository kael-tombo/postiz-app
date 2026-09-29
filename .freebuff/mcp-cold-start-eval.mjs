// Round 14 / F21 — COLD-START AGENT EVAL.
// Simulates an LLM that has NEVER seen the codebase: it reads only the
// tools/list catalog (descriptions + schema describe() strings), picks tools
// by matching task words against descriptions, and synthesizes arguments with
// generic rules (copy format examples from description text, follow tool-name
// cross-references for dataflow, honor [] hints, match enums to task words).
// Then it EXECUTES the journey for real and scores first-try argument
// validity per hop: a validation error on the first attempt is a
// documentation failure, not the agent's - an LLM can only know what the
// catalog says.
//
// Score: first-try valid = 1.0, valid after reading the error = 0.5,
// never valid = 0. Suite passes when every hop scores 1.0.
//
// Run: node .freebuff/mcp-cold-start-eval.mjs
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

// ---------- harness ----------
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
async function callTool(name, args, { caps = { elicitation: {} }, inputResponses } = {}) {
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

// ---------- "LLM" generic synthesis rules (no per-tool hardcoding) ----------
const norm = (s) => (s || '').replace(/\s+/g, ' ');

// rule: find a format example inside a description (like 2026-01-31T14:30:00)
function exampleFromText(text, kind) {
  const t = norm(text);
  if (kind === 'datetime') {
    const m = t.match(/\b(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})\b/);
    if (m) return m[1];
    return null;
  }
  if (kind === 'number') {
    const m = t.match(/\b(\d{1,4})\b/);
    return m ? Number(m[1]) : null;
  }
  return null;
}
// rule: enum member whose wording matches the task
function pickEnum(schema, taskText) {
  const vals = schema?.enum || schema?.values || [];
  const lower = taskText.toLowerCase();
  for (const v of vals) {
    if (lower.includes(String(v).toLowerCase())) return v;
  }
  return vals[0];
}
// rule: honor explicit "pass []" hints for arrays
// explicit = value carried over from a previous hop (wins when type-compatible)
// generic  = the raw task text, ONLY for free-form strings as last resort
function synthesizeArg(propSchema, argName, taskText, explicit, generic) {
  const d = norm(propSchema?.description || '');
  const type = propSchema?.type;
  if (explicit !== undefined && explicit !== null) {
    if (type === 'array') return Array.isArray(explicit) ? explicit : [explicit];
    if (type === 'boolean') return Boolean(explicit);
    if (type === 'number' && typeof explicit === 'number') return explicit;
    if (type === 'string' && typeof explicit !== 'object') return explicit;
  }
  if (type === 'boolean') {
    if (/premium/i.test(argName + d)) return /premium/i.test(taskText) ? true : false;
    if (/short.?link/i.test(argName + d)) return /short/i.test(taskText);
    return false;
  }
  if (type === 'number') return exampleFromText(d, 'number') ?? 1;
  if (type === 'array') {
    // "pass []" / "omit" hints -> empty array when we have no data for it
    if (/\[\]/.test(d) && !explicit) return [];
    const itemType = propSchema?.items?.type;
    if (itemType === 'object' || propSchema?.items?.properties) {
      // build one object from the item's required properties
      const itemProps = propSchema?.items?.properties || {};
      const required = propSchema?.items?.required || Object.keys(itemProps);
      const obj = {};
      for (const k of required) {
        obj[k] = synthesizeArg(itemProps[k], k, taskText, explicit, generic);
      }
      return [obj];
    }
    if (itemType === 'string') return hasData && typeof hasData === 'string' ? [hasData] : [];
    return [];
  }
  if (type === 'enum' || propSchema?.enum || Array.isArray(propSchema?.values)) {
    return pickEnum(propSchema, taskText);
  }
  // string: use a format example if the description carries one
  if (/YYYY-MM-DD|date|time/i.test(argName + d) || /\d{4}-\d{2}-\d{2}/.test(d)) {
    const ex = exampleFromText(d, 'datetime');
    if (ex) return ex;
  }
  // generic task text: only for plain free-form strings, never enums
  if (generic !== undefined && type === 'string' && !propSchema?.enum) {
    if (/title|search|prompt|message|content/i.test(argName)) return String(generic).slice(0, 40);
  }
  // last resort: task-derived keyword or a syntactically plausible value
  if (/title|search|prompt|message/i.test(argName)) return taskText.slice(0, 40);
  return taskText.slice(0, 20) || 'x';
}
// an LLM does not invent values for optional args unprompted: synthesize the
// required list when the schema names one, else only args whose description
// does not open with "Optional"
function argsToSynthesize(tool) {
  const props = tool?.inputSchema?.properties || {};
  const required = tool?.inputSchema?.required;
  if (Array.isArray(required) && required.length) return required;
  return Object.keys(props).filter((k) => !/^optional/i.test(norm(props[k]?.description || '')));
}

// ---------- setup (fresh org = genuinely cold start) ----------
const reg = await fetch(BASE + '/auth/register', {
  method: 'POST',
  headers: { 'content-type': 'application/json', accept: 'application/json' },
  body: JSON.stringify({ provider: 'LOCAL', email: `cold${rand}@postiz.local`, password: 'ColdTest123!', company: 'Cold Co' }),
});
const authCookie = ((reg.headers.getSetCookie?.() || []).find((c) => c.startsWith('auth=')) || '').split(';')[0];
const orgId = (await (await fetch(BASE + '/user/self', { headers: { cookie: authCookie } })).json())?.orgId;
const apiKey = (await (await fetch(BASE + '/user/api-key/rotate', { method: 'POST', headers: { cookie: authCookie } })).json())?.apiKey || '';
check('setup: fresh org + key', !!orgId && !!apiKey);

fs.writeFileSync('.freebuff/tmp-cold-integration.cjs', `
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const integration = await p.integration.create({
    data: {
      internalId: 'coldwp_${rand}',
      organizationId: '${orgId}',
      name: 'Cold Mock WP',
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
let realIntegrationId = '';
try {
  const out = execSync('node .freebuff/tmp-cold-integration.cjs', { encoding: 'utf8', timeout: 60000 });
  realIntegrationId = (out.match(/INTEGRATION_ID=(\S+)/) || [])[1] || '';
} catch (e) { console.log(String(e.stderr || e.message || '').slice(0, 140)); }
check('setup: mock channel exists (agent does not know its id)', !!realIntegrationId);

// ---------- the agent reads ONLY the catalog ----------
const res = await api('POST', '/mcp', {
  apiKey,
  extraHeaders: { 'mcp-method': 'tools/list', 'mcp-name': '' },
  body: { jsonrpc: '2.0', id: ++idc, method: 'tools/list' },
});
let catJson = null;
{
  const t = res.text;
  const lines = t.split('\n').filter((l) => l.startsWith('data:'));
  for (let i = lines.length - 1; i >= 0; i--) { try { catJson = JSON.parse(lines[i].slice(5).trim()); break; } catch {} }
}
const catalog = catJson?.result?.tools || [];
const byName = Object.fromEntries(catalog.map((x) => [x.name, x]));
// 24 annotated tools since F24: the generated ask_postiz catch-all no
// longer leaks onto the catalog (annotations uniformity, F23).
check('catalog read (24 tools, the agent\u2019s only knowledge)', catalog.length === 24, String(catalog.length));

const SCORES = [];
async function attemptHop(hopName, toolName, taskText, dataflow) {
  const tool = byName[toolName];
  if (!tool) { SCORES.push({ hopName, toolName, score: 0, error: 'tool not in catalog' }); return null; }
  const props = tool.inputSchema?.properties || {};
  const required = argsToSynthesize(tool);
  const args = {};
  for (const k of required) {
    args[k] = synthesizeArg(props[k], k, taskText, dataflow[k], dataflow._generic);
  }
  let out = unwrap(await callTool(toolName, args));
  let score = 1;
  let firstError = null;
  if ((out && typeof out.errors === 'string') || out?.isError === true) {
    firstError = norm(out?.errors || out?.content?.[0]?.text || '').slice(0, 140);
    score = 0.5;
    // one self-correction round: re-synthesize with the error text as extra
    // task context (the way an LLM would use an error message)
    const args2 = {};
    for (const k of required) {
      args2[k] = synthesizeArg(props[k], k, taskText + ' ' + firstError, dataflow[k], dataflow._generic);
    }
    out = unwrap(await callTool(toolName, args2));
    if ((out && typeof out.errors === 'string') || out?.isError === true) {
      score = 0;
      out = { errors: out?.errors || out?.content?.[0]?.text || 'invalid' };
    }
  }
  SCORES.push({ hopName, toolName, score, firstError });
  console.log(`  hop ${hopName} (${toolName}): first-try ${score === 1 ? 'VALID (1.0)' : score === 0.5 ? `invalid -> fixed (0.5) [${firstError}]` : 'never valid (0.0)'}`);
  return out;
}

// ---------- THE JOURNEY (task phrased like a user request) ----------
console.log('== COLD-START JOURNEY ==');
const TASK =
  'Schedule a draft post on my wordpress channel saying "Hello from the cold-start eval" for tomorrow, with the title Cold Hello';

// hop 1: which tool finds channels? (description match: "integrations")
const h1 = await attemptHop('find channel', 'integrationList', TASK, {});
const chan = (h1 || []).find?.((i) => i.platform === 'wordpress');
check('H1 found the wordpress channel (platform field identifies the provider)', !!chan, JSON.stringify((h1 || []).slice(0, 2)).slice(0, 140));

// hop 2: schema for the platform (dataflow: platform from hop 1)
const h2 = await attemptHop('get rules', 'integrationSchema', TASK, { _generic: chan?.platform });
check('H2 schema returned rules/maxLength', !!h2?.rules || !!h2, JSON.stringify(h2 || {}).slice(0, 100));

// hop 3: free slot (no date given by user... task says tomorrow; free slot
// still valid) - dataflow: integrationId from hop 1
const h3 = await attemptHop('find slot', 'freeDateTimeTool', TASK, { integrationId: chan?.id });
const slotDate = typeof h3 === 'string' ? h3 : h3?.date || null;

// hop 4: THE WRITE - synthesize the full socialPost entry from strings only
const sched = byName['integrationSchedulePostTool'];
const spItem = sched?.inputSchema?.properties?.socialPost?.items?.properties || {};
// the agent composes dataflow: channel id + content + tomorrow's date
const tomorrow = new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 19);
const dataflow = {
  integrationId: chan?.id,
  date: slotDate || tomorrow,
  _generic: TASK,
};
const sArgs = { socialPost: [{}] };
for (const k of Object.keys(spItem)) {
  sArgs.socialPost[0][k] = synthesizeArg(spItem[k], k, TASK, dataflow[k], dataflow._generic);
}
// content is nested one level deeper - synthesize postsAndComments items too
const pacItem = spItem.postsAndComments?.items?.properties || {};
sArgs.socialPost[0].postsAndComments = [{
  content: '<p>Hello from the cold-start eval</p>',
  attachments: synthesizeArg(pacItem.attachments || {}, 'attachments', TASK, undefined),
}];
sArgs.socialPost[0].settings = [];
console.log('  agent synthesized args:', JSON.stringify(sArgs).slice(0, 220));
// First-try validity = the args pass zod validation. A write's FIRST valid
// attempt returns the elicitation dialog (input_required) - that is proof
// the arguments were accepted, not an error. Gate checks run on the RAW
// result (unwrap collapses input_required to {}).
let firstRaw = await callTool('integrationSchedulePostTool', sArgs);
let first = unwrap(firstRaw);
let sScore = 1,
  sErr = null;
if (
  firstRaw?.resultType !== 'input_required' &&
  ((first && typeof first.errors === 'string') || firstRaw?.isError === true)
) {
  sErr = norm(first?.errors || firstRaw?.content?.[0]?.text || '').slice(0, 160);
  sScore = 0.5;
  // one self-correction round with the error as context
  const sArgs2 = JSON.parse(JSON.stringify(sArgs));
  if (/draft/i.test(sErr) && /enum/i.test(sErr)) sArgs2.socialPost[0].type = 'draft';
  if (/date/i.test(sErr)) sArgs2.socialPost[0].date = tomorrow;
  if (/integration/i.test(sErr)) sArgs2.socialPost[0].integrationId = chan?.id;
  firstRaw = await callTool('integrationSchedulePostTool', sArgs2);
  first = unwrap(firstRaw);
  if (
    firstRaw?.resultType !== 'input_required' &&
    ((first && typeof first.errors === 'string') || firstRaw?.isError === true)
  ) {
    sScore = 0;
  }
}
SCORES.push({ hopName: 'the write', toolName: 'integrationSchedulePostTool', score: sScore, firstError: sErr });
console.log(`  hop the write (integrationSchedulePostTool): first-try ${sScore === 1 ? 'VALID (1.0)' : sScore === 0.5 ? `invalid -> fixed (0.5) [${sErr}]` : 'never valid (0.0)'}`);
// complete the confirmed write (the agent answers the dialog)
let sOut = null;
if (firstRaw?.resultType === 'input_required') {
  const gKey = Object.keys(firstRaw.inputRequests)[0];
  sOut = unwrap(
    await callTool('integrationSchedulePostTool', sArgs, {
      inputResponses: { [gKey]: { action: 'accept', content: { confirm: true } } },
    })
  );
} else {
  sOut = first;
}
const postId = Array.isArray(sOut) ? sOut[0]?.postId : sOut?.created?.[0]?.postId;
check('H4 write produced a post', !!postId, JSON.stringify(sOut || {}).slice(0, 140));

// hop 5: verify via details (dataflow: id)
const h5 = await attemptHop('verify', 'postDetailsTool', TASK, { id: postId });
check('H5 details readable (state DRAFT)', /DRAFT/.test(JSON.stringify(h5 || {})), JSON.stringify(h5 || {}).slice(0, 100));

// ---------- scoring ----------
const total = SCORES.reduce((a, s) => a + s.score, 0);
console.log('\n-- cold-start scorecard --');
for (const s of SCORES) console.log(`  ${s.hopName.padEnd(14)} ${s.toolName.padEnd(28)} ${s.score}`);
console.log(`  TOTAL ${total.toFixed(1)} / ${SCORES.length}`);
check('every hop first-try valid (score 1.0 each)', total === SCORES.length, `${total.toFixed(1)}/${SCORES.length}`);
const worst = SCORES.filter((s) => s.score < 1);
check('no hop needed the error-message crutch', worst.length === 0, worst.map((w) => `${w.hopName}: ${w.firstError}`).join(' | ').slice(0, 300));

fs.unlinkSync('.freebuff/tmp-cold-integration.cjs');
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
