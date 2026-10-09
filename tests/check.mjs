import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
function run(args) {
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
async function check(dir) {
  for (const entry of await readdir(path.join(root, dir), { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) await check(file);
    else if (/\.(?:js|cjs|mjs)$/.test(file)) run(['--check', file]);
  }
}
for (const dir of ['web', 'src', 'api', 'tests']) await check(dir);
run(['--test', 'tests/storage.test.mjs']);
console.log('PASS syntax checks and storage regression tests');
