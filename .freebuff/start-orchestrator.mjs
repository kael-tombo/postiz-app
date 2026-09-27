// Detached orchestrator (Temporal worker) launcher. Run from repo root:
//   node .freebuff/start-orchestrator.mjs
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const root = process.cwd();
const envPath = path.join(root, '.env');

for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m) {
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}

const out = fs.openSync(path.join(root, '.freebuff', 'orchestrator-run.log'), 'a');
const err = fs.openSync(path.join(root, '.freebuff', 'orchestrator-run.err.log'), 'a');

const child = spawn(
  process.execPath,
  ['--experimental-require-module', path.join(root, 'apps', 'orchestrator', 'dist', 'apps', 'orchestrator', 'src', 'main.js')],
  { cwd: path.join(root, 'apps', 'orchestrator'), stdio: ['ignore', out, err], detached: true }
);
child.unref();
console.log('ORCH_CHILD_PID=' + child.pid);
