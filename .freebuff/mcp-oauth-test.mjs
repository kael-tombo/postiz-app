// MCP OAuth client-flow e2e: replays what a real MCP client (Claude / Cursor)
// does against the OAuth-protected MCP endpoints.
//
//   1. RFC 9728 protected-resource discovery on /mcp-oauth-dynamic
//   2. RFC 8414 authorization-server metadata
//   3. RFC 7591 Dynamic Client Registration (public client, PKCE)
//   4. Authorization request (GET consent data) + approve (POST, session cookie)
//   5. Token exchange with code_verifier -> pos_ bearer token
//   6. MCP handshake + tools/list + tools/call on /mcp-oauth-dynamic
//   7. Negative paths: wrong verifier, bad bearer
//   8. Claude directory variant hides the AI media tools
//
// Prereqs: backend running (it serves both the /oauth endpoints and the
// MCP mounts). Run: node .freebuff/mcp-oauth-test.mjs
import crypto from 'node:crypto';

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
  if (result?.structuredContent?.output) return result.structuredContent.output;
  if (result?.output) return result.output;
  try {
    const text = result?.content?.find((c) => c.type === 'text')?.text;
    return text ? JSON.parse(text) : null;
  } catch { return result; }
}

// PKCE (S256), like every real MCP client
const verifier = crypto.randomBytes(32).toString('base64url');
const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
const redirectUri = 'http://localhost:8765/callback';
const state = 'e2e-state-' + crypto.randomBytes(6).toString('hex');

// ---------- 0. fresh user + session (consent approver) ----------
console.log('== SETUP ==');
const email = `mcpoauth${Math.floor(Math.random() * 100000)}@postiz.local`;
let r = await api('POST', '/auth/register', { body: { provider: 'LOCAL', email, password: 'OauthTest123!', company: 'OAuth Co' }, accept: 'application/json' });
const cookie = (r.setCookie.find((c) => c.startsWith('auth=')) || '').split(';')[0];
r = await api('GET', '/user/self', { cookie });
check('register + session', !!r.json?.orgId, `status ${r.status}`);

// ---------- 1. RFC 9728 protected resource ----------
console.log('== DISCOVERY ==');
r = await api('GET', '/.well-known/oauth-protected-resource/mcp-oauth-dynamic', { accept: 'application/json' });
check('protected-resource metadata', r.status === 200 && !!r.json?.resource && Array.isArray(r.json?.authorization_servers), r.text.slice(0, 120));

// ---------- 2. RFC 8414 authorization server ----------
r = await api('GET', '/.well-known/oauth-authorization-server/mcp-oauth-dynamic', { accept: 'application/json' });
const asMeta = r.json;
check('authorization-server metadata', r.status === 200 && asMeta?.issuer?.includes('/mcp-oauth-dynamic') && !!asMeta?.token_endpoint && !!asMeta?.registration_endpoint, r.text.slice(0, 160));
check('metadata advertises S256 PKCE', (asMeta?.code_challenge_methods_supported || []).includes('S256'), JSON.stringify(asMeta?.code_challenge_methods_supported));

// ---------- 3. Dynamic Client Registration (RFC 7591) ----------
console.log('== DCR ==');
r = await api('POST', '/oauth/register', { body: {
  client_name: 'Freebuff E2E MCP Client',
  redirect_uris: [redirectUri],
  token_endpoint_auth_method: 'none',
  grant_types: ['authorization_code'],
  response_types: ['code'],
} });
const clientId = r.json?.client_id;
check('DCR creates a public client', r.status === 201 && !!clientId && String(clientId).startsWith('pcd_'), `status ${r.status} ${r.text.slice(0, 140)}`);
check('public client has no secret', r.json?.client_secret === undefined, String(r.json?.client_secret ?? 'absent'));

// ---------- 4. authorization request + consent ----------
console.log('== AUTHORIZE ==');
r = await api('GET', `/oauth/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}&code_challenge=${challenge}&code_challenge_method=S256`, { cookie });
check('authorization request validates', r.status === 200 && r.json?.app?.clientId === clientId, `status ${r.status} ${r.text.slice(0, 140)}`);

r = await api('POST', '/oauth/authorize', { cookie, body: {
  action: 'approve',
  client_id: clientId,
  redirect_uri: redirectUri,
  code_challenge: challenge,
  code_challenge_method: 'S256',
  state,
} });
const redirect = r.json?.redirect || '';
const code = new URL(redirect).searchParams.get('code') || '';
check('consent approved, code issued', r.status === 200 || r.status === 201, `status ${r.status} ${r.text.slice(0, 140)}`);
check('redirect carries code + state', !!code && new URL(redirect).searchParams.get('state') === state, redirect.slice(0, 140));

// ---------- 5. token exchange ----------
console.log('== TOKEN ==');
r = await api('POST', '/oauth/token', { body: {
  grant_type: 'authorization_code',
  code,
  client_id: clientId,
  code_verifier: 'wrong-verifier-on-purpose',
  redirect_uri: redirectUri,
} });
check('wrong code_verifier rejected', r.status === 400 && r.json?.error === 'invalid_grant', `status ${r.status} ${r.text.slice(0, 120)}`);

r = await api('POST', '/oauth/token', { body: {
  grant_type: 'authorization_code',
  code,
  client_id: clientId,
  code_verifier: verifier,
  redirect_uri: redirectUri,
} });
const oauthToken = r.json?.access_token || '';
check('token exchange succeeds', !!oauthToken && oauthToken.startsWith('pos_'), `status ${r.status} ${r.text.slice(0, 120)}`);

// ---------- 6. MCP over the OAuth-protected mount ----------
console.log('== MCP /mcp-oauth-dynamic ==');
r = await api('POST', '/mcp-oauth-dynamic', {
  apiKey: oauthToken,
  body: rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'freebuff-oauth-e2e', version: '1.0.0' } }),
});
const sessionId = r.sessionId;
check('initialize with OAuth token', r.status === 200 && !!r.json?.result?.serverInfo, `status ${r.status} ${r.text.slice(0, 140)}`);
await api('POST', '/mcp-oauth-dynamic', { apiKey: oauthToken, sessionId, body: rpc('notifications/initialized', undefined, true) });
r = await api('POST', '/mcp-oauth-dynamic', { apiKey: oauthToken, sessionId, body: rpc('tools/list', {}) });
const toolNames = (r.json?.result?.tools || []).map((t) => t.name);
check('tools/list over OAuth', toolNames.length > 0, `status ${r.status}, ${toolNames.length} tools`);
check('agentic tools present (analytics/date/status/slot/media)', ['integrationAnalyticsTool', 'postAnalyticsTool', 'postDateTool', 'postStatusTool', 'freeDateTimeTool', 'mediaListTool'].every((t) => toolNames.includes(t)), toolNames.join(','));
check('dynamic mount keeps AI media tools', toolNames.includes('generateImageTool'), '');

r = await api('POST', '/mcp-oauth-dynamic', { apiKey: oauthToken, sessionId, body: rpc('tools/call', { name: 'integrationList', arguments: {} }) });
const integrations = unwrap(r.json?.result);
check('tools/call returns org data over OAuth', Array.isArray(integrations), JSON.stringify(integrations).slice(0, 120));

// ---------- 7. negatives ----------
console.log('== NEGATIVES ==');
r = await api('POST', '/mcp-oauth-dynamic', { apiKey: 'pos_bogus', body: rpc('tools/list', {}) });
check('bogus bearer rejected on OAuth mount', r.status === 401, `status ${r.status}`);

// the same code cannot be exchanged twice
r = await api('POST', '/oauth/token', { body: { grant_type: 'authorization_code', code, client_id: clientId, code_verifier: verifier, redirect_uri: redirectUri } });
check('authorization code is single-use', r.status === 400, `status ${r.status}`);

// ---------- 8. Claude directory variant ----------
console.log('== CLAUDE VARIANT ==');
r = await api('POST', '/mcp-oauth-claude', { apiKey: oauthToken, body: rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'freebuff-oauth-e2e', version: '1.0.0' } }) });
const claudeSession = r.sessionId;
check('initialize on /mcp-oauth-claude', r.status === 200 && !!r.json?.result?.serverInfo, `status ${r.status}`);
await api('POST', '/mcp-oauth-claude', { apiKey: oauthToken, sessionId: claudeSession, body: rpc('notifications/initialized', undefined, true) });
r = await api('POST', '/mcp-oauth-claude', { apiKey: oauthToken, sessionId: claudeSession, body: rpc('tools/list', {}) });
const claudeTools = (r.json?.result?.tools || []).map((t) => t.name);
check('claude mount hides AI media tools', !claudeTools.includes('generateImageTool') && !claudeTools.includes('clippingTool'), `${claudeTools.length} tools`);
check('claude mount keeps scheduling tools', ['postsListTool', 'integrationSchedulePostTool', 'postDateTool'].every((t) => claudeTools.includes(t)), '');

// The pos_ token also works on the plain /mcp mount (resolveAuth accepts both
// API keys and OAuth tokens there - clients that exchange OAuth then hit /mcp).
r = await api('POST', '/mcp', { apiKey: oauthToken, body: rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'freebuff-oauth-e2e', version: '1.0.0' } }) });
check('pos_ token accepted on plain /mcp too', r.status === 200 && !!r.json?.result?.serverInfo, `status ${r.status}`);

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
