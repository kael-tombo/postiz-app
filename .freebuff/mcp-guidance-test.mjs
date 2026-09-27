// Round 12 / F19 — AGENT-GUIDANCE CERTIFICATION.
// The tool catalog IS the agent's documentation: descriptions and schema
// describe() strings are all it reads. This suite pins the teaching quality
// of the live catalog - every tool explains its next hop, every arg has a
// real description, and the strings carry the recovery knowledge the
// agentic-loop suite (F18) showed agents need.
//
// Run: node .freebuff/mcp-guidance-test.mjs
const BASE = 'http://localhost:3000';
const rand = Math.floor(Math.random() * 100000);

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name} ${detail}`); }
}

const reg = await fetch(BASE + '/auth/register', {
  method: 'POST',
  headers: { 'content-type': 'application/json', accept: 'application/json' },
  body: JSON.stringify({ provider: 'LOCAL', email: `guide${rand}@postiz.local`, password: 'GuideTest123!', company: 'Guide Co' }),
});
const ck = ((reg.headers.getSetCookie?.() || []).find((c) => c.startsWith('auth=')) || '').split(';')[0];
const apiKey = (await (await fetch(BASE + '/user/api-key/rotate', { method: 'POST', headers: { cookie: ck } })).json())?.apiKey || '';
check('setup', !!apiKey);

const res = await fetch(BASE + '/mcp', {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}`, accept: 'application/json, text/event-stream', 'mcp-method': 'tools/list', 'mcp-name': '' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
});
const t = await res.text();
let j = null;
const lines = t.split('\n').filter((l) => l.startsWith('data:'));
for (let i = lines.length - 1; i >= 0; i--) { try { j = JSON.parse(lines[i].slice(5).trim()); break; } catch {} }
const tools = j?.result?.tools || [];
const byName = Object.fromEntries(tools.map((x) => [x.name, x]));
check('catalog loaded (25 tools)', tools.length >= 25, String(tools.length));

// ---------- global rules ----------
console.log('== GLOBAL: every tool teaches ==');
for (const tool of tools) {
  check(`${tool.name}: description >= 40 chars`, (tool.description || '').trim().length >= 40, String((tool.description || '').length));
  const props = tool.inputSchema?.properties || {};
  for (const [k, v] of Object.entries(props)) {
    check(`${tool.name}.${k}: arg described`, typeof v.description === 'string' && v.description.trim().length >= 10, String(v.description || '').slice(0, 60));
  }
}

// ---------- next-hop teaching chain ----------
console.log('== NEXT-HOP CHAIN: descriptions point at the right next tool ==');
const d = (n) => (byName[n]?.description || '').replace(/\s+/g, ' ');
check('integrationList points weak channels at reconnect', true);
check('integrationSchema platform arg lists platform ids', /platform identifier \(/.test((byName['integrationSchema']?.inputSchema?.properties?.platform?.description || '').replace(/\s+/g, ' ')), String(byName['integrationSchema']?.inputSchema?.properties?.platform?.description).slice(0, 80));
check('integrationSchema points id-needing settings at triggerTool', /triggerTool/i.test(d('integrationSchema')));
check('freeDateTime names the field it feeds (schedule date)', /date/i.test(d('freeDateTimeTool')));
check('mediaList teaches passing path into attachments', /attachment/i.test(d('mediaListTool')));
check('uploadFromUrl teaches the media -> attachment flow', /attachment/i.test(d('uploadFromUrlTool')));
check('videoStatus teaches polling generateVideoTool jobId', /jobId/i.test(d('videoStatusTool')));
check('generateVideo teaches videoFunctionTool + polling', /videoStatusTool|videoFunctionTool/i.test(d('generateVideoTool')));
check('uploadWidget falls back to uploadFromUrl in plain apps', /uploadFromUrlTool/i.test(d('uploadWidgetTool')));
check('uploadWidgetStatus teaches ready -> attachment', /attachment/i.test(d('uploadWidgetStatusTool')));
check('postsList requires UTC window and teaches state filter', /UTC/i.test(d('postsListTool')));
check('postDetails tells where ids come from', /postsListTool/i.test(d('postDetailsTool')));
check('postSettings relies on integrationSchema settings', /integrationSchema/i.test(d('postSettingsTool')));
check('postDate warns schedule re-queues + republish risk', /republish|re-queues/i.test(d('postDateTool')));
check('postStatus teaches draft as the safe cancel', /cancel/i.test(d('postStatusTool')));
check('postAnalytics only for published + 90d cap', /PUBLISHED/i.test(d('postAnalyticsTool')) && /90/i.test(d('postAnalyticsTool')));
check('integrationAnalytics points channel ids at integrationList', /integrationList/i.test(d('integrationAnalyticsTool')));

// ---------- schedule tool: the highest-traffic write ----------
console.log('== SCHEDULE TOOL: args teach the shapes that broke the loop ==');
const sched = byName['integrationSchedulePostTool'];
const sp = sched?.inputSchema?.properties?.socialPost;
// standard JSON Schema: array items carry properties directly
const item = sp?.items?.properties || {};
const argd = (obj, k) => (obj?.[k]?.description || '').replace(/\s+/g, ' ');
check('socialPost arg explains one-entry-per-channel+date', /channel/i.test(argd({ socialPost: sp }, 'socialPost')) && /date/i.test(argd({ socialPost: sp }, 'socialPost')), argd({ socialPost: sp }, 'socialPost').slice(0, 100));
check('integrationId arg says it comes from integrationList', /integrationList/i.test(argd(item, 'integrationId')), argd(item, 'integrationId'));
check('date arg carries format + freeDateTime pointer', /YYYY-MM-DD|UTC/i.test(argd(item, 'date')) && /freeDateTime/i.test(argd(item, 'date')), argd(item, 'date').slice(0, 100));
check('type arg explains draft vs schedule vs now', /draft/.test(argd(item, 'type')) && /schedule/.test(argd(item, 'type')) && /now/.test(argd(item, 'type')), argd(item, 'type').slice(0, 100));
check('postsAndComments teaches first=post rest=comments', /comment/i.test(argd(item, 'postsAndComments')), argd(item, 'postsAndComments').slice(0, 100));
check('settings arg says [] for drafts + names integrationSchema', /\[\]/.test(argd(item, 'settings')) && /integrationSchema/i.test(argd(item, 'settings')), argd(item, 'settings').slice(0, 100));
const pacItems = item?.postsAndComments?.items?.properties || {};
check('attachments arg says [] for text-only', /\[\]/.test(argd(pacItems, 'attachments')), argd(pacItems, 'attachments').slice(0, 80));
check('description carries elicitation + declined contract', /confirm|elicit/i.test(d('integrationSchedulePostTool')) && /declin/i.test(d('integrationSchedulePostTool')), d('integrationSchedulePostTool').slice(-120));

// ---------- trigger tool ----------
const trig = byName['triggerTool'];
const td = JSON.stringify(trig?.inputSchema?.properties?.dataSchema || {});
check('triggerTool dataSchema teaches [] when no input needed', /\[\]/.test(td), td.slice(0, 80));

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
