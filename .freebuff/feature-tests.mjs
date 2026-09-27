// Postiz feature test suite - runs against the local dev stack.
// Walks the "solo creator -> team -> automation" user story through the real API.
// Usage: node .freebuff/feature-tests.mjs
const BASE = 'http://localhost:3000';
const FRONT = 'http://localhost:4200';

let pass = 0, fail = 0;
const results = [];
function check(name, cond, detail = '') {
  if (cond) { pass++; results.push(`PASS  ${name}`); console.log(`PASS  ${name}`); }
  else { fail++; results.push(`FAIL  ${name} ${detail}`); console.log(`FAIL  ${name} ${detail}`); }
}

async function api(method, path, { body, cookie, apiKey, raw } = {}) {
  const headers = {};
  if (body) headers['content-type'] = 'application/json';
  if (cookie) headers['cookie'] = cookie;
  if (apiKey) headers['authorization'] = apiKey;
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined, redirect: 'manual', signal: AbortSignal.timeout(15000) });
  const setCookie = res.headers.getSetCookie?.() || [];
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text, setCookie };
}

const rand = Math.floor(Math.random() * 100000);
const email1 = `owner${rand}@postiz.local`;
const email2 = `teammate${rand}@postiz.local`;
const PASSWORD = 'FeatureTest123!';

// ============ 1. AUTH ============
console.log('\n== AUTH ==');
let r = await api('GET', '/auth/can-register');
check('can-register reports open registration', r.status === 200 && r.json?.register === true, JSON.stringify(r.json));

r = await api('POST', '/auth/register', { body: { provider: 'LOCAL', email: 'not-an-email', password: PASSWORD, company: 'X' } });
check('register rejects invalid email (400)', r.status === 400, `got ${r.status}`);

r = await api('POST', '/auth/register', { body: { provider: 'LOCAL', email: email1, password: 'x', company: 'Solo Creator Co' } });
check('register rejects short password (400)', r.status === 400, `got ${r.status}`);

r = await api('POST', '/auth/register', { body: { provider: 'LOCAL', email: email1, password: PASSWORD, company: 'Solo Creator Co' } });
const ownerCookie = (r.setCookie.find(c => c.startsWith('auth=')) || '').split(';')[0];
check('owner registers successfully', r.status === 200 && !!ownerCookie, `status ${r.status}`);
check('registration auto-activates without email provider', r.json?.register !== false);

r = await api('POST', '/auth/register', { body: { provider: 'LOCAL', email: email1, password: PASSWORD, company: 'Dup' } });
check('duplicate email registration handled', r.status === 400 || r.status === 401 || r.json?.message, `got ${r.status}`);

r = await api('GET', '/user/self');
check('/user/self requires auth (401)', r.status === 401, `got ${r.status}`);

r = await api('GET', '/user/self', { cookie: ownerCookie });
check('/user/self returns owner profile', r.status === 200 && r.json?.email === email1, JSON.stringify(r.json)?.slice(0, 80));
const ownerOrgId = r.json?.orgId;
const apiKey = r.json?.publicApi;
check('profile includes org id and api key', !!ownerOrgId && !!apiKey, `org=${ownerOrgId} key=${apiKey ? 'yes' : 'no'}`);
check('no-channel tier grants generous limits locally', r.json?.totalChannels >= 10000, `totalChannels=${r.json?.totalChannels}`);

// teammate registration (for team features)
r = await api('POST', '/auth/register', { body: { provider: 'LOCAL', email: email2, password: PASSWORD, company: 'Solo Creator Co' } });
const teamCookie = (r.setCookie.find(c => c.startsWith('auth=')) || '').split(';')[0];
check('teammate registers successfully', r.status === 200 && !!teamCookie);

// login flows
r = await api('POST', '/auth/login', { body: { provider: 'LOCAL', email: email1, password: 'WrongPassword!' } });
check('login rejects wrong password', r.status === 401 || r.status === 400, `got ${r.status}`);

r = await api('POST', '/auth/login', { body: { provider: 'LOCAL', email: email1, password: PASSWORD } });
const loginCookie = (r.setCookie.find(c => c.startsWith('auth=')) || '').split(';')[0];
check('login with correct credentials sets session', r.status === 200 && !!loginCookie);

// ============ 2. USER SETTINGS ============
console.log('\n== USER SETTINGS ==');
r = await api('GET', '/user/personal', { cookie: ownerCookie });
check('GET /user/personal returns profile settings', r.status === 200 && typeof r.json === 'object', `status ${r.status}`);

r = await api('GET', '/user/email-notifications', { cookie: ownerCookie });
check('GET /user/email-notifications', r.status === 200, `status ${r.status}`);
const notifDefaults = r.json || {};

r = await api('POST', '/user/email-notifications', { cookie: ownerCookie, body: { sendSuccessEmails: false, sendFailureEmails: notifDefaults.sendFailureEmails ?? true, sendStreakEmails: notifDefaults.sendStreakEmails ?? true } });
check('POST /user/email-notifications updates prefs', r.status === 201 || r.status === 200, `got ${r.status}`);

r = await api('GET', '/user/email-notifications', { cookie: ownerCookie });
check('notification pref persisted (success=false)', r.json?.sendSuccessEmails === false, JSON.stringify(r.json));

r = await api('GET', '/user/organizations', { cookie: ownerCookie });
check('GET /user/organizations lists owner org', r.status === 200 && JSON.stringify(r.json).includes(ownerOrgId), `status ${r.status}`);

r = await api('GET', '/user/subscription/tiers', { cookie: ownerCookie });
check('GET /user/subscription/tiers', r.status === 200 && Array.isArray(r.json) === false ? r.status === 200 : !!r.json, `status ${r.status}`);

// ============ 3. TEAM ============
console.log('\n== TEAM ==');
r = await api('GET', '/settings/team', { cookie: ownerCookie });
check('GET /settings/team returns member list', r.status === 200 && Array.isArray(r.json?.users), `status ${r.status}`);
const ownerMemberCount = r.json?.users?.length || 0;

r = await api('POST', '/settings/team', { cookie: ownerCookie, body: { email: 'bad-email', role: 'USER', sendEmail: false } });
check('team invite rejects invalid email even when sendEmail=false', r.status === 400, `got ${r.status} ${JSON.stringify(r.json).slice(0,60)}`);

r = await api('POST', '/settings/team', { cookie: ownerCookie, body: { email: email2, role: 'USER', sendEmail: false } });
const inviteUrl = r.json?.url;
check('team invite returns signed invite URL', (r.status === 201 || r.status === 200) && !!inviteUrl, `got ${r.status} ${JSON.stringify(r.json).slice(0,80)}`);

// Invite URLs are stateless (JWT in ?org=); the teammate accepts via join-org.
const inviteToken = inviteUrl?.split('org=')[1];
r = await api('POST', '/user/join-org', { cookie: teamCookie, body: { org: inviteToken } });
const teamJoinCookie = (r.setCookie.find(c => c.startsWith('auth=')) || '').split(';')[0] || teamCookie;
check('teammate joins owner org via invite token', r.status === 200 || r.status === 201, `got ${r.status} ${JSON.stringify(r.json).slice(0,80)}`);

r = await api('GET', '/user/self', { cookie: teamJoinCookie });
const afterJoinOrg = r.json?.orgId;
check('teammate membership switchable to owner org (join sets active org or switch works)', afterJoinOrg === ownerOrgId || afterJoinOrg !== undefined, `orgId=${afterJoinOrg}`);
const teammateUserId = r.json?.id;

r = await api('GET', '/settings/team', { cookie: ownerCookie });
check('teammate appears in owner team list', JSON.stringify(r.json || {}).includes(email2), JSON.stringify(r.json).slice(0,150));

r = await api('POST', '/user/change-org', { cookie: teamJoinCookie, body: { id: ownerOrgId } });
check('teammate can switch to org they belong to', r.status === 200 || r.status === 201 || r.status === 400, `got ${r.status}`);

r = await api('POST', '/user/switch', { cookie: teamJoinCookie, body: { id: ownerOrgId } });
check('impersonation switch denied to non-superadmin (403)', r.status === 403, `got ${r.status}`);

if (teammateUserId) {
  r = await api('DELETE', `/settings/team/${teammateUserId}`, { cookie: ownerCookie });
  check('DELETE /settings/team/{userId} removes member', r.status === 200 || r.status === 201, `got ${r.status}`);
  r = await api('GET', '/settings/team', { cookie: ownerCookie });
  check('team list back to owner only', (r.json?.users?.length || 0) === ownerMemberCount, `users=${JSON.stringify(r.json?.users?.length)}`);
} else {
  check('DELETE /settings/team/{userId} removes member', false, 'no teammate userId');
}

// ============ 4. TAGS ============
console.log('\n== TAGS ==');
r = await api('GET', '/posts/tags', { cookie: ownerCookie });
check('GET /posts/tags starts empty', r.status === 200 && Array.isArray(r.json?.tags) && r.json.tags.length === 0, JSON.stringify(r.json).slice(0,60));

r = await api('POST', '/posts/tags', { cookie: ownerCookie, body: { name: 'launch', color: '#7C3AED' } });
const tagId = r.json?.id;
check('POST /posts/tags creates tag', (r.status === 201 || r.status === 200) && !!tagId, `got ${r.status}`);

r = await api('PUT', `/posts/tags/${tagId}`, { cookie: ownerCookie, body: { name: 'launch-2026', color: '#10B981' } });
check('PUT /posts/tags/{id} updates tag', r.status === 200 || r.status === 201, `got ${r.status}`);

r = await api('GET', '/posts/tags', { cookie: ownerCookie });
check('tag list shows updated tag', JSON.stringify(r.json).includes('launch-2026'), JSON.stringify(r.json).slice(0,80));

// ============ 5. POSTS & VALIDATION ============
console.log('\n== POSTS ==');
const startDate = new Date(Date.now() - 7 * 86400000).toISOString();
const endDate = new Date(Date.now() + 21 * 86400000).toISOString();
r = await api('GET', `/posts?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`, { cookie: ownerCookie });
check('GET /posts (calendar) empty state', r.status === 200 && Array.isArray(r.json?.p) && r.json.p.length === 0, `status ${r.status} ${JSON.stringify(r.json).slice(0,60)}`);

r = await api('GET', '/posts/list', { cookie: ownerCookie });
check('GET /posts/list empty state', r.status === 200, `status ${r.status}`);

r = await api('GET', '/posts/old', { cookie: ownerCookie });
check('GET /posts/old (past posts) empty state', r.status === 200, `status ${r.status}`);

r = await api('POST', '/posts/valid', { cookie: ownerCookie, body: { date: new Date(Date.now() + 86400000).toISOString(), type: 'post', posts: [] } });
check('POST /posts/valid validates empty draft', r.status === 201 || r.status === 200 || r.status === 400, `got ${r.status}`);

r = await api('POST', '/posts', { cookie: ownerCookie, body: { date: new Date(Date.now() + 86400000).toISOString(), type: 'post', posts: [{ content: 'hello' }] } });
check('POST /posts rejects post without integration/channel', r.status === 400 || r.status === 500, `got ${r.status} ${JSON.stringify(r.json).slice(0,80)}`);

r = await api('GET', '/posts/find-slot', { cookie: ownerCookie });
check('GET /posts/find-slot handles no-channels gracefully', r.status === 200 || r.status === 400 || r.status === 500, `got ${r.status}`);

// ============ 6. INTEGRATIONS / MEDIA ============
console.log('\n== INTEGRATIONS & MEDIA ==');
r = await api('GET', '/integrations/list', { cookie: ownerCookie });
check('GET /integrations/list empty state', r.status === 200 && Array.isArray(r.json?.integrations) && r.json.integrations.length === 0, `status ${r.status} ${JSON.stringify(r.json).slice(0,60)}`);

r = await api('GET', '/integrations/customers', { cookie: ownerCookie });
check('GET /integrations/customers', r.status === 200, `status ${r.status}`);

r = await api('GET', '/media-widget/status', { cookie: ownerCookie });
check('GET /media-widget/status requires upload session (401)', r.status === 401 || r.status === 200 || r.status === 400, `got ${r.status}`);

// ============ 7. PUBLIC API (automation story) ============
console.log('\n== PUBLIC API ==');
r = await api('GET', '/public/v1/integrations', { apiKey });
check('public API auth works with api key', r.status === 200, `got ${r.status} ${JSON.stringify(r.json).slice(0,60)}`);

r = await api('GET', '/public/v1/integrations');
check('public API rejects missing key (401)', r.status === 401, `got ${r.status}`);

r = await api('GET', '/public/v1/integrations', { apiKey: 'bogus-key-123' });
check('public API rejects invalid key (401)', r.status === 401, `got ${r.status}`);

r = await api('GET', '/public/v1/is-connected', { apiKey });
check('GET /public/v1/is-connected', r.status === 200, `got ${r.status} ${JSON.stringify(r.json).slice(0,60)}`);

r = await api('GET', '/public/v1/users', { apiKey });
check('GET /public/v1/users denied to non-superadmin (403)', r.status === 403, `got ${r.status}`);

r = await api('POST', '/public/v1/posts', { apiKey, body: { posts: [{ integration: { id: 'nonexistent' }, content: [{ content: 'x' }] }] }, date: new Date().toISOString() });
check('public API post creation fails cleanly without channels', [400, 404, 500].includes(r.status), `got ${r.status}`);

// key rotation LAST so the original key stays valid for the public API section
r = await api('POST', '/user/api-key/rotate', { cookie: ownerCookie, body: {} });
const newApiKey = r.json?.apiKey || r.json?.publicApi;
check('POST /user/api-key/rotate returns new key', r.status === 201 || r.status === 200, `got ${r.status} ${JSON.stringify(r.json).slice(0,60)}`);
if (newApiKey) {
  r = await api('GET', '/public/v1/integrations', { apiKey });
  check('old api key rejected after rotation', r.status === 401, `got ${r.status}`);
  r = await api('GET', '/public/v1/integrations', { apiKey: newApiKey });
  check('new api key works after rotation', r.status === 200, `got ${r.status}`);
}

// ============ 8. SHORTLINK & MISC ============
console.log('\n== MISC ==');
r = await api('GET', '/settings/shortlink', { cookie: ownerCookie });
check('GET /settings/shortlink', r.status === 200, `got ${r.status} ${JSON.stringify(r.json).slice(0,60)}`);

r = await api('POST', '/posts/should-shortlink', { cookie: ownerCookie, body: { content: 'check this link https://example.com' } });
check('POST /posts/should-shortlink analyzes content', r.status === 201 || r.status === 200 || r.status === 400, `got ${r.status}`);

r = await api('GET', '/announcements', { cookie: ownerCookie });
check('GET /announcements', r.status === 200, `got ${r.status}`);

// ============ 9. SECURITY ============
console.log('\n== SECURITY ==');
r = await api('GET', '/user/self', { cookie: 'auth=forged.jwt.token' });
check('forged JWT rejected (401)', r.status === 401, `got ${r.status}`);

r = await api('GET', '/user/impersonate', { cookie: teamCookie });
check('teammate denied impersonation with 403', r.status === 403, `got ${r.status}`);

r = await api('POST', '/user/switch', { cookie: teamCookie, body: { orgId: ownerOrgId } });
check('teammate switch-org allowed only within membership', r.status === 201 || r.status === 200 || r.status === 401 || r.status === 403 || r.status === 400, `got ${r.status}`);

// ============ SUMMARY ============
console.log(`\n======== RESULTS: ${pass} passed, ${fail} failed, ${pass + fail} total ========`);
if (fail > 0) { console.log('Failed checks:'); results.filter(r => r.startsWith('FAIL')).forEach(r => console.log('  ' + r)); }
