import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadProjectEnvironment } from '../src/server/environment';

// Run the production worker in a clean copy, preserving the user's projects and settings.
const source = fileURLToPath(new URL('../', import.meta.url));
loadProjectEnvironment(source);
const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'miyo 兼容 smoke '));
const pause = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));
const report: Record<string, unknown> = { platform: process.platform, architecture: process.arch, node: process.version, checkedAt: new Date().toISOString() };
let cleanupSafe = false;
let cleanupFailedJobs: (() => Promise<void>) | undefined;
try {
  for (const folder of ['src', 'scripts', 'fixtures', 'public', 'voice-library']) await fs.cp(path.join(source, folder), path.join(sandbox, folder), { recursive: true });
  await fs.copyFile(path.join(source, 'package.json'), path.join(sandbox, 'package.json'));
  await fs.symlink(path.join(source, 'node_modules'), path.join(sandbox, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  if (await fs.stat(path.join(source, '.venv')).then(stat => stat.isDirectory()).catch(() => false)) {
    await fs.symlink(path.join(source, '.venv'), path.join(sandbox, '.venv'), process.platform === 'win32' ? 'junction' : 'dir');
  }
  for (const key of ['MOYO_MLX_PYTHON', 'MOYO_KIANA_MODEL', 'MOYO_KIANA_VOICE_DIR', 'MOYO_KIANA_REFERENCE', 'MOYO_KIANA_REFERENCE_TEXT', 'MOYO_KIANA_PRESETS']) delete process.env[key];
  for (const key of ['MOYO_PYTHON', 'MOYO_FFMPEG', 'MOYO_FFPROBE', 'MOYO_EDGE_TTS', 'MOYO_CHROMIUM']) {
    const value = process.env[key];
    if (value) {
      const expanded = /^~[\\/]/.test(value) ? path.join(os.homedir(), value.slice(2)) : value;
      const local = path.resolve(source, expanded);
      if (/[\\/]/.test(value) || await fs.stat(local).then(stat => stat.isFile()).catch(() => false)) process.env[key] = local;
    }
  }
  process.env.MOYO_ROOT = sandbox;
  process.env.MOYO_DATA_DIR = path.join(sandbox, 'data');
  const storage = await import('../src/server/storage');
  const { createJob, cancelJob } = await import('../src/server/tasks');
  const { projectResponse } = await import('../src/server/preview');
  const { listProcesses, captureTaskProcess, terminateTaskProcess, recoverTaskProcesses } = await import('../src/server/process-tree');
  const { pythonCommand, toolCommand, browserExecutable } = await import('../src/server/runtime');
  report.tools = { python: pythonCommand(), ffmpeg: toolCommand('ffmpeg'), ffprobe: toolCommand('ffprobe'), chromium: browserExecutable() };
  const createdJobs: string[] = [];
  cleanupFailedJobs = async () => {
    for (const id of createdJobs) {
      const job = await storage.getJob(id);
      if (['running', 'queued'].includes(job.status)) await cancelJob(id);
    }
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline && (await storage.listJobs()).some(job => createdJobs.includes(job.id) && ['running', 'queued'].includes(job.status))) await pause(300);
    for (const id of createdJobs) {
      const job = await storage.getJob(id);
      await recoverTaskProcesses(storage.runPath(id), job.childProcess, job.childPgid);
    }
    const lock = await storage.readJson<{ pid: number }>(path.join(storage.DATA, 'worker.lock')).catch(() => undefined);
    if (lock) {
      const identity = await captureTaskProcess(lock.pid, path.join(sandbox, 'scripts/worker.ts'));
      if (identity) await terminateTaskProcess(identity);
    }
  };
  console.log(`验证 ${process.platform}/${process.arch}：配音、取消任务、1080p 视频导出（临时项目含空格和中文路径）`);
  await storage.ensureInitialized();
  const original = await storage.importFixture('platform-smoke');
  const base = await storage.readJson<{ scenes: { id: string; duration: number }[] }>(path.join(storage.FIXTURES, 'base-episode.json'));
  const shortest = [...base.scenes].sort((a, b) => a.duration - b.duration)[0];
  const project = await storage.saveProject({ ...original, scenes: original.scenes.filter(scene => scene.id === shortest.id), voice: { ...original.voice, speed: 2 }, presentation: { ...original.presentation, particles: 0 } }, original.revision);
  async function waitJob(id: string, predicate: (job: Awaited<ReturnType<typeof storage.getJob>>) => boolean, milliseconds: number) {
    const deadline = Date.now() + milliseconds;
    while (Date.now() < deadline) {
      const job = await storage.getJob(id);
      if (predicate(job)) return job;
      if (['failed', 'cancelled', 'succeeded'].includes(job.status)) throw new Error(`任务提前结束：${JSON.stringify(job)}`);
      await pause(300);
    }
    throw new Error(`任务超时：${JSON.stringify(await storage.getJob(id))}`);
  }
  const prepared = await createJob(project, 'prepare');
  createdJobs.push(prepared.id);
  await waitJob(prepared.id, job => job.status === 'succeeded', 120_000);
  assert.equal((await projectResponse(project)).preview.ready, true, '网页与 Worker 必须识别同一份配音缓存');
  report.prepare = { result: 'passed', jobId: prepared.id };
  console.log('配音及网页缓存识别通过');
  const cancelled = await createJob(project, 'render');
  createdJobs.push(cancelled.id);
  await waitJob(cancelled.id, job => job.stage === 'render' && !!job.childProcess, 120_000);
  const partial = path.join(storage.runPath(cancelled.id), 'video.partial.mp4');
  const encodeDeadline = Date.now() + 60_000;
  while (!await storage.exists(partial)) {
    const job = await storage.getJob(cancelled.id);
    if (job.status !== 'running' || Date.now() > encodeDeadline) throw new Error(`编码未开始：${JSON.stringify(job)}`);
    await pause(300);
  }
  await cancelJob(cancelled.id);
  const terminal = await waitJob(cancelled.id, job => job.status === 'cancelled', 60_000);
  assert.equal(terminal.childProcess, undefined);
  assert.equal(await storage.exists(path.join(storage.runPath(cancelled.id), 'video.mp4')), false);
  const normalize = (value: string) => value.replace(/\\/g, '/').toLowerCase();
  assert.equal((await listProcesses()).some(row => normalize(row.command).includes(normalize(storage.runPath(cancelled.id)))), false, '取消后不应留下渲染或编码进程');
  report.cancel = { result: 'passed', jobId: cancelled.id };
  console.log('实际渲染取消及进程清理通过');
  const exported = await createJob(project, 'render');
  createdJobs.push(exported.id);
  await waitJob(exported.id, job => job.status === 'succeeded', 240_000);
  const result = await storage.readJson<Record<string, unknown>>(path.join(storage.runPath(exported.id), 'render-report.json'));
  const provenance = await storage.readJson<{ reusedFrom: string }>(path.join(storage.runPath(exported.id), 'audio-provenance.json'));
  assert.ok([prepared.id, cancelled.id].includes(provenance.reusedFrom), '重试应复用本次已准备好的音轨');
  assert.equal(await storage.fileHash(path.join(storage.runPath(exported.id), 'narration.wav')), await storage.fileHash(path.join(storage.runPath(prepared.id), 'narration.wav')));
  assert.equal(result.result, 'passed'); assert.equal(result.fullDecode, 'passed');
  assert.equal(result.width, 1920); assert.equal(result.height, 1080);
  for (const file of ['narration.wav', 'subtitles.srt', 'episode.html', 'video.mp4']) assert.ok((await fs.stat(path.join(storage.runPath(exported.id), file))).size > 0, file);
  report.export = { ...result, jobId: exported.id, reusedFrom: provenance.reusedFrom };
  console.log(`1080p MP4、音画时长、字幕和完整解码通过（${result.duration} 秒）`);
  const workerDeadline = Date.now() + 30_000;
  while (await storage.exists(path.join(storage.DATA, 'worker.lock'))) {
    if (Date.now() > workerDeadline) throw new Error('Worker 未按预期空闲退出');
    await pause(300);
  }
  assert.equal((await listProcesses()).some(row => normalize(row.command).includes(normalize(sandbox))), false, '验证完成后临时项目进程必须退出');
  cleanupSafe = true;
  report.result = 'passed';
} catch (error) {
  report.result = 'failed'; report.error = String(error); report.sandbox = sandbox;
  if (cleanupFailedJobs) {
    try { await cleanupFailedJobs(); report.failureCleanup = 'passed'; }
    catch (cleanupError) { report.failureCleanup = String(cleanupError); console.error('未能确认验证任务清理完成：', cleanupError); }
  }
  console.error(error); console.error(`验证失败，临时项目与日志保留在 ${sandbox}`);
  process.exitCode = 1;
} finally {
  const reportDirectory = path.join(source, 'data', 'verification', 'platform-runtime-' + Date.now());
  await fs.mkdir(reportDirectory, { recursive: true });
  await fs.writeFile(path.join(reportDirectory, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`验证报告：${path.join(reportDirectory, 'report.json')}`);
  if (cleanupSafe) {
    await fs.unlink(path.join(sandbox, 'node_modules'));
    await fs.unlink(path.join(sandbox, '.venv')).catch(() => {});
    await fs.rm(sandbox, { recursive: true, force: true });
  }
}
