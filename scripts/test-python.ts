import { spawn } from 'node:child_process';
import { ROOT, pythonCommand, runtimeEnvironment } from '../src/server/runtime';

const python = pythonCommand();
const child = spawn(python.executable, [...python.args, '-m', 'unittest', 'discover', '-s', 'tests', '-p', '*_test.py', '-v'], {
  cwd: ROOT, env: runtimeEnvironment(), windowsHide: true, stdio: 'inherit',
});
child.on('error', error => { console.error(error); process.exitCode = 1; });
child.on('close', code => { process.exitCode = code ?? 1; });
