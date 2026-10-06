import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

// Expand the test files in Node so Windows and Unix shells use the same list.
const files = readdirSync(new URL('../tests/', import.meta.url))
  .filter(name => name.endsWith('.test.ts'))
  .sort()
  .map(name => `tests/${name}`);
if (!files.length) throw new Error('No TypeScript test files found.');
const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', ...files], {
  cwd: new URL('../', import.meta.url),
  stdio: 'inherit',
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
