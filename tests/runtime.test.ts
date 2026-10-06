import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

let runtime: any;
let root: string;
const executable = (name: string) => process.platform === 'win32' ? `${name}.exe` : name;
before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'miyo-runtime-'));
  runtime = await import('../src/server/runtime').catch(error => {
    if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
    throw error;
  });
});
after(async () => { await fs.rm(root, { recursive: true, force: true }); });
function feature(name: string) { assert.equal(typeof runtime[name], 'function', `${name} is required for portable runtime configuration`); return runtime[name]; }
async function tool(name: string) {
  const directory = path.join(root, 'tools with spaces');
  await fs.mkdir(directory, { recursive: true });
  const file = path.join(directory, executable(name));
  await fs.writeFile(file, 'fixture', { mode: 0o755 });
  return file;
}

test('project env files preserve shell values and prefer .env.local over .env', async () => {
  await fs.writeFile(path.join(root, '.env'), 'MOYO_DATA_DIR=data/base\nMOYO_FFMPEG=tools/base\n');
  await fs.writeFile(path.join(root, '.env.local'), 'MOYO_DATA_DIR="data/local space"\nMOYO_FFMPEG=tools/local\n');
  const env = { MOYO_FFMPEG: 'shell-value' };
  feature('loadProjectEnvironment')(root, env);
  assert.deepEqual(env, { MOYO_FFMPEG: 'shell-value', MOYO_DATA_DIR: 'data/local space' });
});
test('relative configured paths resolve against the project rather than the caller directory', () => {
  assert.equal(feature('resolveProjectPath')('voice-library/reference.wav', root), path.join(root, 'voice-library/reference.wav'));
});
test('home-relative configuration paths agree with Python expanduser', () => {
  assert.equal(feature('resolveProjectPath')('~/.cache/miyo/model', root), path.join(os.homedir(), '.cache/miyo/model'));
  assert.equal(runtime.resolveProjectPath('~', root), os.homedir());
});
test('explicit media paths support spaces and fail visibly instead of silently choosing PATH tools', async () => {
  const file = await tool('ffmpeg');
  assert.equal(feature('toolCommand')('ffmpeg', { root, env: { MOYO_FFMPEG: path.relative(root, file) } }), file);
  assert.throws(() => runtime.toolCommand('ffmpeg', { root, env: { MOYO_FFMPEG: 'tools/missing' } }), /MOYO_FFMPEG|ffmpeg/);
});
test('ffprobe is discovered beside an explicitly configured ffmpeg', async () => {
  const ffmpeg = await tool('ffmpeg');
  const ffprobe = await tool('ffprobe');
  assert.equal(feature('toolCommand')('ffprobe', { root, env: { MOYO_FFMPEG: ffmpeg, PATH: '' } }), ffprobe);
});
test('automatic ffprobe discovery prefers the selected ffmpeg directory', async () => {
  const ffmpeg = await tool('ffmpeg');
  const ffprobe = await tool('ffprobe');
  const other = path.join(root, 'other-tools');
  await fs.mkdir(other, { recursive: true });
  await fs.writeFile(path.join(other, executable('ffprobe')), 'fixture', { mode: 0o755 });
  assert.equal(feature('toolCommand')('ffprobe', { root, env: { PATH: [other, path.dirname(ffmpeg)].join(path.delimiter) } }), ffprobe);
});
test('a bare configured filename can be relative to the project root', async () => {
  const filename = executable('local-ffmpeg');
  const file = path.join(root, filename);
  await fs.writeFile(file, 'fixture', { mode: 0o755 });
  assert.equal(feature('toolCommand')('ffmpeg', { root, env: { MOYO_FFMPEG: filename, PATH: '' } }), file);
});
test('worker environment resolves tools and keeps archived voice reuse eligible', async () => {
  const ffmpeg = await tool('ffmpeg');
  const env = feature('runtimeEnvironment')({ root, env: { MOYO_FFMPEG: path.relative(root, ffmpeg) } });
  assert.equal(env.MOYO_FFMPEG, ffmpeg);
  assert.equal(env.PYTHONUTF8, '1');
  assert.equal(env.PYTHONUNBUFFERED, '1');
  assert.equal(Object.hasOwn(env, 'MOYO_KIANA_MODEL'), false);
  assert.equal(Object.hasOwn(env, 'MOYO_MLX_PYTHON'), false);
});
test('automatic Python discovery launches Python 3 on the current platform', () => {
  const command = feature('pythonCommand')();
  const result = spawnSync(command.executable, [...command.args, '-c', 'import sys; assert sys.version_info >= (3, 10)'], { windowsHide: true });
  assert.equal(result.status, 0, String(result.stderr));
});
test('MLX and voice defaults stay inside the selected project', () => {
  const paths = feature('kianaPaths')({ root, env: {} });
  assert.equal(paths.voice, path.join(root, 'voice-library/琪亚娜-稳重轻角色感'));
  assert.equal(paths.model, path.join(root, 'models/Qwen3-TTS-12Hz-1.7B-Base-4bit'));
  assert.equal(paths.python, path.join(root, '.venv-mlx', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'));
});
