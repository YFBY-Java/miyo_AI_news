import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright';
import { loadProjectEnvironment } from './environment';

export { loadProjectEnvironment };
const initialRoot = path.resolve(process.env.MOYO_ROOT || process.cwd());
loadProjectEnvironment(initialRoot);
export const ROOT = path.resolve(process.env.MOYO_ROOT || initialRoot);
// Home and local tools belong to the machine running the studio. Resolve home at
// runtime so Next's dependency tracer cannot glob or package the user's files.
function hostHomeDirectory(): string { return Reflect.get(os, 'homedir')(); }
export function resolveProjectPath(value: string, root = ROOT) {
  const expanded = value === '~' ? hostHomeDirectory() : /^~[\\/]/.test(value) ? path.join(hostHomeDirectory(), value.slice(2)) : value;
  return path.resolve(root, expanded);
}
interface Options { root?: string; env?: NodeJS.ProcessEnv }
type Tool = 'ffmpeg' | 'ffprobe' | 'edge-tts';
function fileExists(file: string) { try { return fs.statSync(file).isFile(); } catch { return false; } }
function executableNames(name: string) {
  if (process.platform !== 'win32') return [name];
  return /\.exe$/i.test(name) ? [name] : [name + '.exe'];
}
function searchDirectories(root: string, env: NodeJS.ProcessEnv) {
  const venv = path.join(root, '.venv', process.platform === 'win32' ? 'Scripts' : 'bin');
  const pathValue = Object.entries(env).find(([key]) => key.toUpperCase() === 'PATH')?.[1] || '';
  const directories = [venv, ...pathValue.split(path.delimiter).filter(Boolean)];
  if (process.platform !== 'win32') directories.push('/opt/homebrew/bin', '/usr/local/bin', path.join(hostHomeDirectory(), '.homebrew/bin'), path.join(hostHomeDirectory(), '.local/bin'));
  return directories;
}
function findExecutable(value: string, root: string, env: NodeJS.ProcessEnv, configured = false): string | undefined {
  if (path.isAbsolute(value) || /[\\/]/.test(value)) {
    const file = resolveProjectPath(value, root);
    // Windows batch wrappers require a shell; media/voice arguments stay out of shells.
    if (process.platform === 'win32' && !/\.exe$/i.test(file)) return undefined;
    return fileExists(file) ? file : undefined;
  }
  if (configured) {
    const local = resolveProjectPath(value, root);
    if ((process.platform !== 'win32' || /\.exe$/i.test(local)) && fileExists(local)) return local;
  }
  for (const directory of searchDirectories(root, env)) for (const name of executableNames(value)) {
    const file = path.resolve(directory, name);
    if (fileExists(file) && !/Microsoft[\\/]WindowsApps/i.test(file)) return file;
  }
}
export function toolCommand(name: Tool, { root = ROOT, env = process.env }: Options = {}): string {
  const key = 'MOYO_' + name.toUpperCase().replace('-', '_');
  if (env[key]) {
    const file = findExecutable(env[key]!, root, env, true);
    if (!file) throw new Error(`${key} 指向的 ${name} 不可执行；请配置已有工具路径。`);
    return file;
  }
  if (name === 'ffprobe') {
    try {
      const ffmpeg = toolCommand('ffmpeg', { root, env });
      for (const filename of executableNames('ffprobe')) {
        const sibling = path.join(path.dirname(ffmpeg), filename);
        if (fileExists(sibling)) return sibling;
      }
    } catch { /* FFprobe can also be installed independently. */ }
  }
  const file = findExecutable(name, root, env);
  if (!file) throw new Error(`缺少 ${name}；请安装工具或配置 ${key}。`);
  return file;
}
export function runtimeEnvironment({ root = ROOT, env = process.env }: Options = {}): NodeJS.ProcessEnv {
  const result = { ...env, PYTHONUTF8: '1', PYTHONUNBUFFERED: '1' };
  for (const name of ['ffmpeg', 'ffprobe', 'edge-tts'] as const) {
    const key = 'MOYO_' + name.toUpperCase().replace('-', '_');
    try { result[key] = toolCommand(name, { root, env }); } catch { /* Missing tools are diagnosed by the operation that needs them. */ }
  }
  return result;
}
export function pythonCommand({ root = ROOT, env = process.env }: Options = {}): { executable: string; args: string[] } {
  const candidates: { executable?: string; args: string[] }[] = [];
  if (env.MOYO_PYTHON) {
    candidates.push({ executable: findExecutable(env.MOYO_PYTHON, root, env, true), args: /^py(?:\.exe)?$/i.test(path.basename(env.MOYO_PYTHON)) ? ['-3'] : [] });
  } else {
    const venv = path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
    if (fileExists(venv)) candidates.push({ executable: venv, args: [] });
    if (process.platform === 'win32') candidates.push({ executable: findExecutable('py', root, env), args: ['-3'] });
    for (const name of ['python3', 'python']) candidates.push({ executable: findExecutable(name, root, env), args: [] });
  }
  for (const candidate of candidates) if (candidate.executable) {
    const probe = spawnSync(candidate.executable, [...candidate.args, '-c', 'import sys; assert sys.version_info >= (3, 10); print("miyo-python-ready")'], { encoding: 'utf8', timeout: 5000, windowsHide: true, env: { ...env, PYTHONUTF8: '1' } });
    if (probe.status === 0 && probe.stdout.includes('miyo-python-ready')) return { executable: candidate.executable, args: candidate.args };
  }
  throw new Error(env.MOYO_PYTHON ? 'MOYO_PYTHON 需要指向可运行的 Python 3.10 或以上解释器。' : '未找到 Python 3.10 或以上；Windows 可安装 Python Launcher，或配置 MOYO_PYTHON。');
}
export function kianaPaths({ root = ROOT, env = process.env }: Options = {}) {
  const resolve = (key: string, fallback: string) => resolveProjectPath(env[key] || fallback, root);
  const voice = resolve('MOYO_KIANA_VOICE_DIR', 'voice-library/琪亚娜-稳重轻角色感');
  return {
    voice,
    python: resolve('MOYO_MLX_PYTHON', process.platform === 'win32' ? '.venv-mlx/Scripts/python.exe' : '.venv-mlx/bin/python'),
    model: resolve('MOYO_KIANA_MODEL', 'models/Qwen3-TTS-12Hz-1.7B-Base-4bit'),
    reference: resolve('MOYO_KIANA_REFERENCE', path.join(voice, 'kiana_refs_concat_v2_light.wav')),
    referenceText: resolve('MOYO_KIANA_REFERENCE_TEXT', path.join(voice, 'reference_audio_v2_light/ref_text.txt')),
    presets: resolve('MOYO_KIANA_PRESETS', path.join(voice, 'test/qwen17b-v2-light-versions/variants.json')),
  };
}
export function browserExecutable() {
  const file = process.env.MOYO_CHROMIUM ? findExecutable(process.env.MOYO_CHROMIUM, ROOT, process.env, true) : chromium.executablePath();
  if (!file || !fileExists(file)) throw new Error('未找到 Playwright Chromium；请运行 npx playwright install chromium 或配置 MOYO_CHROMIUM。');
  return file;
}
export function toolAvailable(name: Tool) {
  try { return spawnSync(toolCommand(name), [name === 'edge-tts' ? '--version' : '-version'], { stdio: 'ignore', timeout: 5000, windowsHide: true }).status === 0; } catch { return false; }
}
