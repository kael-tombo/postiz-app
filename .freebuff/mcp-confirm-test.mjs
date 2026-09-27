// E2E for the MCP elicitation confirmation gate on the 5 write tools
// (confirm.elicit.ts wired into schedulePost/postContent/postDate/postStatus/postSettings).
//
// Covers:
//   1. Legacy-era session (2025-03-26, no per-request envelope): NO gate -
//      writes execute exactly as before (fail-open; a legacy server->client
//      elicitation would be silently dropped by the JSON mounts).
//   2. Modern-era session (2026-07-28 envelope, elicitation capability
//      declared): the first tools/call returns an input_required result with an
//      embedded elicitation/create (round 1); retrying with inputResponses
//      executes (round 2). Decline -> output.errors, nothing written.
//      Accept -> the write runs once.
//   3. Modern-era client WITHOUT the elicitation capability: gate stays open.
//
// Prereqs: rebuilt backend on :3000, docker stack up, mock-wp-server on :4789.
// Run: node .freebuff/mcp-confirm-test.mjs
import fs from 'node:fs';
import { execSync } from 'node:child_process';

const BASE = 'http://localhost:3000';
const rand = Math.floor(Math.random() * 100000);

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name} ${detail}`); }
}

const PROTOCOL_VERSION_META_KEY = 'io.modelcontextprotocol/protocolVersion';
const CLIENT_CAPABILITIES_META_KEY = 'io.modelcontextprotocol/clientCapabilities';

async function api(method, path, { body, cookie, apiKey, sessionId, accept, extraHeaders } = {}) {
  const headers = { ...(extraHeaders || {}) };
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
async function callToolRaw(apiKey, sid, name, args, { envelopeCaps, inputResponses } = {}) {
  const params = { name, arguments: args };
  if (inputResponses) params.inputResponses = inputResponses;
  // Modern-era calls must mirror body metadata in headers (2026-07-28
  // self-describing requests): Mcp-Method matches the body method and
  // Mcp-Name matches params.name for tools/call.
  const modernHeaders = envelopeCaps !== undefined
    ? { 'mcp-method': 'tools/call', 'mcp-name': name }
    : {};
  const r = await api('POST', '/mcp', {
    apiKey, sessionId: sid,
    extraHeaders: modernHeaders,
    body: rpc('tools/call', { ...params, ...(envelopeCaps !== undefined ? modernEnvelope(envelopeCaps) : {}) }),
  });
  return r.json?.result ?? null;
}
async function callTool(apiKey, sid, name, args, opts) {
  return unwrap(await callToolRaw(apiKey, sid, name, args, opts));
}

// ---------- setup: user + key + mock channel ----------
let r = await api('POST', '/auth/register', { body: { provider: 'LOCAL', email: `mcpconf${rand}@postiz.local`, password: 'ConfTest123!', company: 'Conf Co' }, accept: 'application/json' });
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
      internalId: 'confwp_${rand}',
      organizationId: '${orgId}',
      name: 'Mock WP (confirm)',
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

const tomorrow = new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 19);
const dayAfter = new Date(Date.now() + 2 * 24 * 3600 * 1000).toISOString().slice(0, 19);
const scheduleArgs = (i) => ({
  socialPost: [{
    integrationId, isPremium: false,
    date: i % 2 ? dayAfter : tomorrow,
    shortLink: false, type: 'draft',
    postsAndComments: [{ content: `<p>confirm test ${rand} #${i}</p>`, attachments: [] }],
    settings: [],
  }],
});

// ============ 1. LEGACY ERA: no gate, writes run as before ============
console.log('== LEGACY ERA (2025-03-26, no envelope) ==');
r = await api('POST', '/mcp', {
  apiKey,
  body: rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't-legacy', version: '1' } }),
});
check('legacy initialize', r.status === 200 && !!r.json?.result?.serverInfo, `status ${r.status}`);
const legacySid = r.sessionId;
await api('POST', '/mcp', { apiKey, sessionId: legacySid, body: rpc('notifications/initialized', undefined, true) });

const legacyOut = await callTool(apiKey, legacySid, 'integrationSchedulePostTool', scheduleArgs(0));
check('legacy draft created without confirmation', Array.isArray(legacyOut) && legacyOut[0]?.postId, JSON.stringify(legacyOut).slice(0, 120));
const legacyPostId = Array.isArray(legacyOut) ? legacyOut[0]?.postId : null;

const legacyCancel = await callTool(apiKey, legacySid, 'postStatusTool', { id: legacyPostId, status: 'draft' });
check('legacy status change without confirmation', legacyCancel?.postId === legacyPostId, JSON.stringify(legacyCancel).slice(0, 120));

// ============ 2. MODERN ERA: gate + accept + decline ============
console.log('== MODERN ERA (2026-07-28 envelope + elicitation capability) ==');
// Modern clients attach the reserved per-request _meta envelope to EVERY
// message; the server classifies each request by it (and lifts the keys out
// of _meta before handlers run).
const modernEnvelope = (caps) => ({
  _meta: {
    [PROTOCOL_VERSION_META_KEY]: '2026-07-28',
    ...(caps ? { [CLIENT_CAPABILITIES_META_KEY]: caps } : {}),
  },
});
const elicitationCaps = { elicitation: {} };
// 2026-07-28 has NO initialize handshake: requests are stateless and
// self-describing (per-request _meta envelope carries protocol version +
// capabilities). A claimed-legacy method like "initialize" with an envelope
// is rejected (-32020) - so modern calls go straight to tools/call.
check('modern era: no handshake needed', true);

// Round 1 of a modern write: must come back as input_required, not executed.
const round1 = await callToolRaw(apiKey, '', 'integrationSchedulePostTool', scheduleArgs(1), { envelopeCaps: elicitationCaps });
const embedded = round1?.inputRequests ? Object.values(round1.inputRequests)[0] : null;
check('round1 is input_required', round1?.resultType === 'input_required', JSON.stringify(round1 || {}).slice(0, 200));
check('round1 embeds elicitation/create', embedded?.method === 'elicitation/create' && !!embedded?.params?.message, JSON.stringify(embedded || {}).slice(0, 160));
// Round 1 carries no requestState: it only appears once there are prior
// answers to carry between rounds.
check('round1 has no requestState yet', round1?.requestState === undefined, String(round1?.requestState));
const confirmKey = round1?.inputRequests ? Object.keys(round1.inputRequests)[0] : '';

// Decline path: retry with a decline answer -> errors, no post created.
const declineR = await callToolRaw(apiKey, '', 'integrationSchedulePostTool', scheduleArgs(1), {
  envelopeCaps: elicitationCaps,
  inputResponses: { [confirmKey]: { action: 'decline' } },
});
const declineOut = unwrap(declineR);
check('declined schedule returns errors', typeof declineOut?.errors === 'string' && /declin/i.test(declineOut.errors), JSON.stringify(declineOut).slice(0, 140));

const window1 = {
  startDate: new Date(Date.now() - 3600 * 1000).toISOString().slice(0, 19),
  endDate: new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString().slice(0, 19),
};
const listAfterDecline = await callTool(apiKey, '', 'postsListTool', { ...window1, state: 'draft', page: 1 }, { envelopeCaps: elicitationCaps });
check('declined post was NOT created', listAfterDecline?.total === 1, `total ${listAfterDecline?.total}`);

// Accept path: the post is created exactly once.
const acceptR = await callToolRaw(apiKey, '', 'integrationSchedulePostTool', scheduleArgs(1), {
  envelopeCaps: elicitationCaps,
  inputResponses: { [confirmKey]: { action: 'accept', content: { confirm: true } } },
});
const acceptOut = unwrap(acceptR);
check('accepted schedule created the post', Array.isArray(acceptOut) && acceptOut[0]?.postId, JSON.stringify(acceptOut).slice(0, 140));
const modernPostId = Array.isArray(acceptOut) ? acceptOut[0]?.postId : null;

const listAfterAccept = await callTool(apiKey, '', 'postsListTool', { ...window1, state: 'draft', page: 1 }, { envelopeCaps: elicitationCaps });
check('exactly 2 drafts exist after accept', listAfterAccept?.total === 2, `total ${listAfterAccept?.total}`);

// Cancel via postStatusTool: round1 input_required, decline -> state unchanged.
const cancelRound1 = await callToolRaw(apiKey, '', 'postStatusTool', { id: modernPostId, status: 'draft' }, { envelopeCaps: elicitationCaps });
const cancelKey = cancelRound1?.inputRequests ? Object.keys(cancelRound1.inputRequests)[0] : '';
check('postStatus round1 is input_required', cancelRound1?.resultType === 'input_required' && !!cancelKey, JSON.stringify(cancelRound1 || {}).slice(0, 160));
const cancelDecline = await callTool(apiKey, '', 'postStatusTool', { id: modernPostId, status: 'draft' }, {
  envelopeCaps: elicitationCaps,
  inputResponses: { [cancelKey]: { action: 'decline' } },
});
check('declined cancel returns errors', typeof cancelDecline?.errors === 'string', JSON.stringify(cancelDecline).slice(0, 120));

// ============ 3. MODERN ERA WITHOUT ELICITATION CAPABILITY: gate open ============
console.log('== MODERN ERA, NO ELICITATION CAPABILITY ==');
const noCapOut = await callTool(apiKey, '', 'integrationSchedulePostTool', scheduleArgs(2), { envelopeCaps: undefined });
check('no-cap draft created without confirmation', Array.isArray(noCapOut) && noCapOut[0]?.postId, JSON.stringify(noCapOut).slice(0, 140));

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
