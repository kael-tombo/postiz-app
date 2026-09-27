// Round 10 / F17 — MODERN-ERA METHOD-SURFACE CERTIFICATION.
// Pins which MCP methods the 2026-07-28 mounts serve, that every unsupported
// method fails fast with -32601 (never hangs), the exact -32020 header/body
// mirroring contract, and the MCP Apps ui widget resource correctness.
//
// Prereqs: backend on :3000 (dual-era auto). Run: node .freebuff/mcp-method-matrix-test.mjs
const BASE = 'http://localhost:3000';
const rand = Math.floor(Math.random() * 100000);
const ERA = '2026-07-28';
const PV = 'io.modelcontextprotocol/protocolVersion';
const CC = 'io.modelcontextprotocol/clientCapabilities';
const BACKEND_ORIGIN = BASE;

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
    redirect: 'manual',
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  let json = null;
  if ((res.headers.get('content-type') || '').includes('text/event-stream')) {
    const lines = text.split('\n').filter((l) => l.startsWith('data:'));
    for (let i = lines.length - 1; i >= 0; i--) { try { json = JSON.parse(lines[i].slice(5).trim()); break; } catch {} }
  } else { try { json = JSON.parse(text); } catch {} }
  return { status: res.status, json, text };
}
let idc = 0;
// modern request with full control over envelope + mirror headers
async function call(method, params, { envelope = true, methodHeader, nameHeader } = {}) {
  const headers = {};
  if (methodHeader) headers['mcp-method'] = method;
  if (nameHeader !== undefined) headers['mcp-name'] = nameHeader;
  const bodyParams = envelope ? { ...params, _meta: { [PV]: ERA, [CC]: {} } } : params;
  const r = await api('POST', '/mcp', {
    apiKey,
    extraHeaders: headers,
    body: { jsonrpc: '2.0', id: ++idc, method, ...(Object.keys(bodyParams).length || envelope ? { params: bodyParams } : {}) },
  });
  return r;
}

// ---------- setup ----------
const regRes = await fetch(BASE + '/auth/register', {
  method: 'POST',
  headers: { 'content-type': 'application/json', accept: 'application/json' },
  body: JSON.stringify({ provider: 'LOCAL', email: `mm2${rand}@postiz.local`, password: 'MmTest123!', company: 'Mm Co' }),
});
const authCookie = ((regRes.headers.getSetCookie?.() || []).find((c) => c.startsWith('auth=')) || '').split(';')[0];
const keyRes = await fetch(BASE + '/user/api-key/rotate', { method: 'POST', headers: { cookie: authCookie } });
const apiKey = (await keyRes.json())?.apiKey || '';
check('register + api key', !!apiKey);

let r;
// ============ A. SERVED METHODS ============
console.log('== A. SERVED METHODS (modern era serves exactly these) ==');
r = await call('server/discover', {}, { methodHeader: true, nameHeader: '' });
check('server/discover served', r.status === 200 && Array.isArray(r.json?.result?.supportedVersions), `${r.status} ${JSON.stringify(r.json?.error || {}).slice(0, 100)}`);
r = await call('tools/list', {}, { methodHeader: true, nameHeader: '' });
check('tools/list served', r.status === 200 && Array.isArray(r.json?.result?.tools), `${r.status}`);
check('catalog size >= 25', (r.json?.result?.tools?.length || 0) >= 25, String(r.json?.result?.tools?.length));
r = await call('tools/call', { name: 'postsListTool', arguments: { startDate: '2024-01-01', endDate: '2026-12-31', page: 1 } }, { methodHeader: true, nameHeader: 'postsListTool' });
check('tools/call (read) served', r.status === 200 && !!r.json?.result, `${r.status}`);
r = await call('resources/list', {}, { methodHeader: true, nameHeader: '' });
const resources = r.json?.result?.resources || [];
check('resources/list served', r.status === 200, `${r.status}`);
check('exactly 1 widget resource (local storage: no clipping)', resources.length === 1 && resources[0].uri === 'ui://postiz/upload', JSON.stringify(resources.map((x) => x.uri)));
check('widget advertised as mcp-app html', resources[0]?.mimeType === 'text/html;profile=mcp-app', resources[0]?.mimeType);
check('widget has name + description for host UI', resources[0]?.name === 'Upload Media' && (resources[0]?.description || '').length > 10, JSON.stringify(resources[0] || {}).slice(0, 100));

const URI = 'ui://postiz/upload';
r = await call('resources/read', { uri: URI }, { methodHeader: true, nameHeader: URI });
const c0 = r.json?.result?.contents?.[0];
check('resources/read serves widget html', r.status === 200 && c0?.uri === URI && (c0?.text || '').length > 1000, `${r.status} ${(c0?.text || '').length}`);
check('widget content-type carries mcp-app profile', c0?.mimeType === 'text/html;profile=mcp-app', c0?.mimeType);
const wmeta = c0?._meta?.ui || {};
check('widget csp pins backend origin', Array.isArray(wmeta.csp?.connectDomains) && wmeta.csp.connectDomains.includes(BACKEND_ORIGIN), JSON.stringify(wmeta.csp || {}));
check('widget requests clipboard permission (copy-link button)', !!wmeta.permissions?.clipboardWrite, JSON.stringify(wmeta.permissions || {}));
check('widget prefers border (MCP Apps display hint)', wmeta.prefersBorder === true, JSON.stringify(wmeta));
check('widget html is a self-contained document', /<script/i.test(c0?.text || '') && /html/i.test(c0?.text || ''), String(c0?.text || '').slice(0, 60));

// ============ B. UNSUPPORTED METHODS FAIL FAST ============
console.log('== B. UNSUPPORTED METHODS (-32601, fast JSON error, never hangs) ==');
const unsupported = [
  ['ping', {}],
  ['resources/templates/list', {}],
  ['resources/subscribe', { uri: URI }],
  ['resources/unsubscribe', { uri: URI }],
  ['logging/setLevel', { level: 'info' }],
  ['prompts/list', {}],
  ['prompts/get', { name: 'x' }],
  ['completion/complete', { ref: { type: 'ref/prompt', name: 'x' }, argument: { name: 'a', value: 'b' } }],
  ['sampling/createMessage', { messages: [{ role: 'user', content: { type: 'text', text: 'hi' } }], maxTokens: 10 }],
  ['roots/list', {}],
  ['elicitation/create', { mode: 'form', message: 'x', requestedSchema: { type: 'object', properties: {} } }],
  ['tasks/list', {}],
  ['tasks/get', { taskId: 'nope' }],
  ['tasks/cancel', { taskId: 'nope' }],
  ['tasks/result', { taskId: 'nope' }],
  ['foo/bar', {}],
];
const t0 = Date.now();
let allFast = true;
for (const [m, p] of unsupported) {
  const rr = await call(m, p, { methodHeader: true, nameHeader: m === 'prompts/get' ? 'x' : m === 'resources/subscribe' || m === 'resources/unsubscribe' ? URI : '' });
  const ok = rr.status === 404 && rr.json?.error?.code === -32601;
  if (!ok || Date.now() - t0 > 20000) allFast = false;
  check(`${m} -> -32601 fast`, ok, `${rr.status} ${JSON.stringify(rr.json?.error || {}).slice(0, 80)}`);
}
check('all unsupported methods answered in <20s total', allFast, `${Date.now() - t0}ms`);

// ============ C. HEADER/BODY MIRRORING MATRIX (-32020) ============
console.log('== C. HEADER/BODY MIRRORING MATRIX ==');
r = await call('tools/list', {}, { envelope: true, methodHeader: false });
check('envelope WITHOUT mcp-method header -> -32020', r.status === 400 && r.json?.error?.code === -32020, `${r.status} ${JSON.stringify(r.json?.error || {}).slice(0, 90)}`);
r = await call('tools/list', {}, { envelope: false, methodHeader: true, nameHeader: '' });
check('mcp-method header WITHOUT envelope -> legacy 200', r.status === 200 && Array.isArray(r.json?.result?.tools), `${r.status}`);
r = await call('tools/call', { name: 'postsListTool', arguments: { startDate: '2024-01-01', endDate: '2026-12-31', page: 1 } }, { methodHeader: true, nameHeader: 'differentTool' });
check('tools/call disagreeing mcp-name -> -32020', r.status === 400 && r.json?.error?.code === -32020, `${r.status} ${JSON.stringify(r.json?.error || {}).slice(0, 90)}`);
r = await call('resources/read', { uri: URI }, { methodHeader: true, nameHeader: 'ui://wrong' });
check('resources/read wrong mcp-name -> -32020', r.status === 400 && r.json?.error?.code === -32020, `${r.status}`);
r = await call('resources/read', { uri: URI }, { methodHeader: true, nameHeader: undefined });
check('resources/read missing mcp-name -> -32020', r.status === 400 && r.json?.error?.code === -32020, `${r.status}`);
r = await call('tools/call', { name: 'postsListTool', arguments: { startDate: '2024-01-01', endDate: '2026-12-31', page: 1 } }, { methodHeader: true, nameHeader: 'postsListTool' });
check('matching mirrors -> 200', r.status === 200 && !!r.json?.result, `${r.status}`);

// ============ D. ERROR CONTRACT SHAPE ============
console.log('== D. ERROR CONTRACT SHAPE (agent-consumable) ==');
// Unknown tool never reaches our tools - Mastra answers at the protocol layer
// with the spec-correct shape: isError:true + text naming the tool (not a
// crash, not a hang, not a JSON-RPC error).
r = await call('tools/call', { name: 'notATool', arguments: {} }, { methodHeader: true, nameHeader: 'notATool' });
const ukRes = r.json?.result;
const ukText = ukRes?.content?.find((c) => c.type === 'text')?.text || '';
check('unknown tool -> isError:true + text (protocol shape, no crash)', ukRes?.isError === true && /unknown tool/i.test(ukText) && ukRes?.resultType === 'complete', JSON.stringify(ukRes || r.json || {}).slice(0, 120));
r = await call('tools/call', { name: 'postDetailsTool', arguments: { id: 'no-such-post' } }, { methodHeader: true, nameHeader: 'postDetailsTool' });
const pd = unwrap(r.json?.result);
check('postDetails unknown id -> structured errors', pd && (typeof pd.errors === 'string' || pd.post === null), JSON.stringify(pd || {}).slice(0, 100));

function unwrap(result) {
  if (result?.structuredContent?.output !== undefined) return result.structuredContent.output;
  if (result?.output !== undefined) return result.output;
  try {
    const text = result?.content?.find((c) => c.type === 'text')?.text;
    return text ? JSON.parse(text) : null;
  } catch { return result; }
}

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
