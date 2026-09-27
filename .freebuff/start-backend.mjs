// Detached backend launcher (PowerShell start scripts hang the tool session).
// Parses .env, then spawns the compiled backend detached. Run from repo root:
//   node .freebuff/start-backend.mjs
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
process.env.PORT = '3000';
process.env.MAIN_URL = process.env.MAIN_URL || 'http://localhost:4200';

const out = fs.openSync(path.join(root, '.freebuff', 'backend-run.log'), 'a');
const err = fs.openSync(path.join(root, '.freebuff', 'backend-run.err.log'), 'a');

const child = spawn(
  process.execPath,
  ['--experimental-require-module', path.join(root, 'apps', 'backend', 'dist', 'apps', 'backend', 'src', 'main.js')],
  { cwd: path.join(root, 'apps', 'backend'), stdio: ['ignore', out, err], detached: true }
);
child.unref();
console.log('BACKEND_CHILD_PID=' + child.pid);
