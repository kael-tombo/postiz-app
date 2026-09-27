// Post-lifecycle test: mock channel -> schedule -> Temporal workflow -> PUBLISHED.
//
// Chain under test (verified against source):
//   POST /posts (type=now)  ->  Post{state: QUEUE}  + Temporal workflow
//   'postWorkflowV112' (id post_<postId>) on task queue 'wordpress'
//   -> activity postSocialPending -> WordpressProvider.post()
//   -> POST {domain}/wp-json/wp/v2/posts  (our mock)
//   -> activity updatePost -> Post{state: PUBLISHED, releaseId, releaseURL}
//
// Prereqs: full stack running; orchestrator restarted with
// DISABLE_SSRF_PROTECTION=true (trusted local mock); mock WP server running.
//
// Run: node .freebuff/post-lifecycle-test.mjs
import fs from 'node:fs';
import { execSync } from 'node:child_process';

const BASE = 'http://localhost:3000';
// The posting worker (orchestrator) runs on the host, not in Docker, so the
// mock channel domain must be host-resolvable. SSRF guard is opted out via
// DISABLE_SSRF_PROTECTION=true in .env (trusted local mock).
const MOCK_DOMAIN = '127.0.0.1';
const MOCK_WP = `http://${MOCK_DOMAIN}:4789`;

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name} ${detail}`); }
}

async function api(method, path, { body, cookie, apiKey } = {}) {
  const headers = {};
  if (body) headers['content-type'] = 'application/json';
  if (cookie) headers['cookie'] = cookie;
  if (apiKey) headers['authorization'] = apiKey;
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined, redirect: 'manual', signal: AbortSignal.timeout(20000) });
  const setCookie = res.headers.getSetCookie?.() || [];
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text, setCookie };
}

const rand = Math.floor(Math.random() * 100000);
const email = `lifecycle${rand}@postiz.local`;
const PASSWORD = 'Lifecycle123!';

// ---------- 0. prereqs ----------
console.log('== PREREQS ==');
try {
  fs.rmSync('.freebuff/mock-wp-received.json', { force: true });
} catch {}
let mockHealth;
try {
  mockHealth = await fetch(`${MOCK_WP}/wp-json/wp/v2/users/me`, { headers: { Authorization: 'Basic ' + Buffer.from('u:p').toString('base64') }, signal: AbortSignal.timeout(3000) }).then(r => r.status);
} catch { mockHealth = 0; }
check('mock WP server reachable on 127.0.0.1:4789', mockHealth === 200, `got ${mockHealth}`);

// ---------- 1. register + session ----------
console.log('== REGISTER ==');
let r = await api('POST', '/auth/register', { body: { provider: 'LOCAL', email, password: PASSWORD, company: 'Lifecycle Co' } });
const cookie = (r.setCookie.find(c => c.startsWith('auth=')) || '').split(';')[0];
check('register + session', r.status === 200 && !!cookie, `status ${r.status}`);

r = await api('GET', '/user/self', { cookie });
const orgId = r.json?.orgId;
check('profile with org', !!orgId, JSON.stringify(r.json).slice(0, 60));

// ---------- 2. inject mock wordpress channel (Prisma) ----------
console.log('== MOCK CHANNEL ==');
// token = base64({domain, username, password}) - exactly what the provider parses.
const wpToken = Buffer.from(JSON.stringify({
  domain: `http://${MOCK_DOMAIN}:4789`,
  username: 'mockuser',
  password: 'mockpass',
})).toString('base64');

const prismaScript = `
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const org = await p.organization.findUniqueOrThrow({ where: { id: '${orgId}' } });
  const integration = await p.integration.create({
    data: {
      internalId: 'mockwp_${rand}',
      organizationId: org.id,
      name: 'Mock WordPress (test)',
      providerIdentifier: 'wordpress',
      type: 'article',
      token: '${wpToken}',
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
  console.log(String(e.stdout || ''), String(e.stderr || '').slice(0, 200));
}
check('mock wordpress integration created in DB', !!integrationId, integrationId);

if (!integrationId) { console.log('\nABORT: cannot continue without channel'); process.exit(1); }

// channel visible via API
r = await api('GET', '/integrations/list', { cookie });
check('channel appears in /integrations/list', JSON.stringify(r.json || {}).includes(integrationId), JSON.stringify(r.json).slice(0, 120));

// ---------- 3. create the post (type=now) ----------
console.log('== CREATE POST ==');
r = await api('POST', '/posts', { cookie, body: {
  type: 'now',
  shortLink: false,
  date: new Date().toISOString(),
  tags: [],
  posts: [{
    integration: { id: integrationId },
    value: [{ content: 'Lifecycle test post from the automated suite', image: [] }],
    settings: {
      __type: 'wordpress',
      title: 'Lifecycle Test Post',
      type: 'posts',
      status: 'publish',
    },
  }],
}});
const postId = r.json?.[0]?.postId;
check('POST /posts accepted (now)', r.status === 200 || r.status === 201, `status ${r.status} ${JSON.stringify(r.json).slice(0,120)}`);
check('post id returned', !!postId, JSON.stringify(r.json).slice(0, 120));

if (!postId) process.exit(1);

// ---------- 4. temporal workflow scheduled ----------
console.log('== TEMPORAL ==');
const temporalScript = `
const { Client, Connection } = require('@temporalio/client');
(async () => {
  const conn = await Connection.connect({ address: 'localhost:7233' });
  const client = new Client({ connection: conn });
  try {
    const handle = client.workflow.getHandle('post_${postId}');
    const desc = await handle.describe();
    console.log('WF_STATUS=' + desc.status.name);
    console.log('WF_TYPE=' + (desc.type?.name || desc.type || ''));
    console.log('WF_RUNID=' + desc.runId);
  } catch (e) {
    console.log('WF_ERR=' + e.message?.slice(0, 120));
    process.exit(2);
  }
  process.exit(0);
})();
`;
fs.writeFileSync('.freebuff/tmp-temporal-describe.cjs', temporalScript);

let wfStatus = '';
let wfType = '';
const deadline = Date.now() + 150000;
let sawWorkflow = false;
while (Date.now() < deadline) {
  try {
    const out = execSync('node .freebuff/tmp-temporal-describe.cjs', { encoding: 'utf8', timeout: 60000, env: { ...process.env, TEMPORAL_ADDRESS: 'localhost:7233' } });
    wfStatus = (out.match(/WF_STATUS=(\S+)/) || [])[1] || '';
    wfType = (out.match(/WF_TYPE=(\S+)/) || [])[1] || '';
    sawWorkflow = true;
    if (wfStatus === 'COMPLETED' || wfStatus === 'FAILED') break;
  } catch (e) {
    const errOut = String(e.stderr || e.message || '');
    if (errOut.includes('not exist')) { /* workflow not started yet */ }
    else { console.log('temporal describe:', errOut.slice(0, 140)); }
  }
  await new Promise(r => setTimeout(r, 5000));
}
check('Temporal workflow postWorkflowV112 was started for the post', sawWorkflow, 'workflow handle never found');
check('workflow type is postWorkflowV112', wfType === 'postWorkflowV112', `got ${wfType}`);
check('workflow reached COMPLETED', wfStatus === 'COMPLETED', `final status ${wfStatus || 'none'}`);

// ---------- 5. mock received the provider call ----------
console.log('== PROVIDER CALL ==');
let mockReceived = [];
const mockDeadline = Date.now() + 30000;
const expectedAuth = 'Basic ' + Buffer.from('mockuser:mockpass').toString('base64');
while (Date.now() < mockDeadline) {
  try { mockReceived = JSON.parse(fs.readFileSync('.freebuff/mock-wp-received.json', 'utf8')); } catch {}
  // Match OUR worker's call specifically: authenticated + non-empty body
  // (filters out this suite's own unauthenticated health probes).
  if (mockReceived.some(m => m.url === '/wp-json/wp/v2/posts' && m.method === 'POST' && m.auth === expectedAuth && (m.body || '').length > 0)) break;
  await new Promise(r => setTimeout(r, 1000));
}
const publishCall = mockReceived.find(m => m.url === '/wp-json/wp/v2/posts' && m.method === 'POST' && m.auth === expectedAuth && (m.body || '').length > 0);
check('worker called mock WP POST /wp-json/wp/v2/posts', !!publishCall, `received=${mockReceived.length} reqs`);
check('provider sent basic auth (from channel token)', !!publishCall?.auth?.startsWith('Basic '), publishCall?.auth?.slice(0, 20));
if (publishCall) {
  let parsed = {};
  try { parsed = JSON.parse(publishCall.body); } catch {}
  check('payload contains our content', JSON.stringify(parsed).includes('Lifecycle test post'), JSON.stringify(parsed).slice(0, 100));
}

// ---------- 6. post is PUBLISHED ----------
console.log('== FINAL STATE ==');
let postJson = null;
const pubDeadline = Date.now() + 30000;
while (Date.now() < pubDeadline) {
  r = await api('GET', `/posts/${postId}`, { cookie });
  // GET /posts/:id returns the group wrapper: { group, posts: [...] }
  postJson = r.json?.posts?.[0] || r.json;
  if (postJson?.state === 'PUBLISHED') break;
  await new Promise(r => setTimeout(r, 1500));
}
check('post state is PUBLISHED', postJson?.state === 'PUBLISHED', `state=${postJson?.state} body=${JSON.stringify(r.json).slice(0, 120)}`);
check('releaseId recorded from provider', !!postJson?.releaseId, `releaseId=${postJson?.releaseId}`);
check('releaseURL points at the mock', String(postJson?.releaseURL || '').includes('127.0.0.1:4789'), `releaseURL=${postJson?.releaseURL}`);

// ---------- cleanup: integration only (posts cascade via API level FK) ----------
try {
  fs.writeFileSync('.freebuff/tmp-cleanup.cjs', `
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  try { await p.integration.delete({ where: { id: '${integrationId}' } }); } catch {}
  try { await p.post.deleteMany({ where: { id: '${postId}' } }); } catch {}
  await p.$disconnect();
  process.exit(0);
})();
`);
  execSync('node .freebuff/tmp-cleanup.cjs', { timeout: 60000 });
} catch {}

console.log(`\n======== LIFECYCLE RESULTS: ${pass} passed, ${fail} failed ========`);
process.exit(fail ? 1 : 0);
