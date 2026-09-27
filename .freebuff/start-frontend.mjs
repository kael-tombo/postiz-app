// Frontend fallback launcher (see .freebuff/run.md): pnpm run dev is broken on
// this box (dotenv-cli relative path), so parse .env manually and spawn
// `next dev -p 4200` detached. Run from apps/frontend: node ../../.freebuff/start-frontend.mjs
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const root = path.resolve(process.cwd(), '..', '..');
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
process.env.NEXT_TELEMETRY_DISABLED = '1';

const child = spawn(
  process.execPath,
  [path.join(root, 'node_modules', 'next', 'dist', 'bin', 'next'), 'dev', '-p', '4200'],
  { cwd: process.cwd(), stdio: 'ignore', detached: true }
);
child.unref();
console.log('FRONTEND_CHILD_PID=' + child.pid);
