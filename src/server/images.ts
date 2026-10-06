import fs from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import type { ImageAsset, Project } from '../core/types';
import { InputError, safeId } from '../core/project';
import { DATA, atomicJson, mediaUrl, readJson } from './storage';

export const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 32_000_000;
export const MAX_PROJECT_IMAGE_BYTES = 60 * 1024 * 1024;
const extensions = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' } as const;
interface StoredImage extends ImageAsset { sha256: string }
const directory = () => path.join(DATA, 'assets');
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

// Parsing multipart only after a bounded read avoids trusting Content-Length.
export async function readImageUpload(request: Request): Promise<File> {
  if (!/^multipart\/form-data\s*;/i.test(request.headers.get('content-type') || '')) throw new InputError('请通过文件选择或拖拽上传图片');
  const limit = MAX_IMAGE_BYTES + 64 * 1024;
  if (Number(request.headers.get('content-length')) > limit) throw new InputError('图片不能超过 12 MB', 413);
  const reader = request.body?.getReader();
  if (!reader) throw new InputError('未收到图片');
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new InputError('图片不能超过 12 MB', 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  let form: FormData;
  try { form = await new Response(Buffer.concat(chunks), { headers: { 'Content-Type': request.headers.get('content-type')! } }).formData(); }
  catch { throw new InputError('无法读取上传文件，请重新选择图片'); }
  const values = form.getAll('file');
  if (values.length !== 1 || !(values[0] instanceof File) || [...form.keys()].some(key => key !== 'file')) throw new InputError('请一次上传一张图片');
  return values[0];
}

function animatedPng(bytes: Buffer): boolean {
  if (bytes.length < 8 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') return false;
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = bytes.readUInt32BE(offset);
    if (bytes.toString('ascii', offset + 4, offset + 8) === 'acTL') return true;
    offset += length + 12;
  }
  return false;
}

export async function storeImage(file: File): Promise<ImageAsset> {
  if (!file.size || file.size > MAX_IMAGE_BYTES) throw new InputError('请选择不超过 12 MB 的图片', file.size ? 413 : 400);
  if (!file.name || file.name.length > 512) throw new InputError('图片文件名需要为 1–512 字');
  const bytes = Buffer.from(await file.arrayBuffer());
  let mime: ImageAsset['mime']; let width: number; let height: number;
  try {
    const decoder = sharp(bytes, { limitInputPixels: MAX_IMAGE_PIXELS, failOn: 'warning' });
    const meta = await decoder.metadata();
    const types: Record<string, ImageAsset['mime']> = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' };
    mime = types[meta.format || ''];
    if (!mime) throw new InputError('支持 PNG、JPG 和静态 WebP 图片');
    if ((meta.pages || 1) > 1 || animatedPng(bytes)) throw new InputError('请使用静态图片；暂不支持 GIF、APNG 或动态 WebP');
    if (!meta.width || !meta.height || meta.width * meta.height > MAX_IMAGE_PIXELS) throw new InputError('图片总像素不能超过 3200 万');
    // Fully decode to detect truncation. Only the original bytes are persisted.
    await decoder.stats();
    const rotated = meta.orientation && meta.orientation >= 5;
    width = rotated ? meta.height : meta.width; height = rotated ? meta.width : meta.height;
  } catch (error) {
    if (error instanceof InputError) throw error;
    throw new InputError('图片无法完整解码或尺寸过大，请选择有效的 PNG、JPG 或静态 WebP（最多 3200 万像素）');
  }
  const id = randomUUID(); const dir = path.join(directory(), id);
  const filename = path.join(dir, 'image.' + extensions[mime]);
  const asset: StoredImage = { id, name: file.name, mime, width, height, size: bytes.length, createdAt: new Date().toISOString(), url: mediaUrl(filename), sha256: digest(bytes) };
  await fs.mkdir(directory(), { recursive: true });
  await assetRoot();
  await fs.mkdir(dir, { recursive: true });
  try { await fs.writeFile(filename, bytes, { flag: 'wx' }); await atomicJson(path.join(dir, 'metadata.json'), asset); }
  catch (error) { await fs.rm(dir, { recursive: true, force: true }); throw error; }
  return asset;
}

async function assetRoot(): Promise<string> {
  const data = await fs.realpath(DATA);
  const root = await fs.realpath(directory()).catch(() => { throw new InputError('配图素材不存在，请重新上传', 404); });
  if (!root.startsWith(data + path.sep)) throw new InputError('素材库不能指向项目数据目录之外', 403);
  return root;
}

async function insideAssets(file: string): Promise<string> {
  const root = await assetRoot();
  const resolved = await fs.realpath(file).catch(() => { throw new InputError('配图素材不存在，请重新上传', 404); });
  if (!resolved.startsWith(root + path.sep)) throw new InputError('不可读取此配图路径', 403);
  return resolved;
}

export async function getImage(id: string): Promise<StoredImage> {
  const dir = path.join(directory(), safeId(id));
  const asset = await readJson<StoredImage>(await insideAssets(path.join(dir, 'metadata.json')));
  if (asset.id !== id || !Object.hasOwn(extensions, asset.mime) || !Number.isInteger(asset.size) || asset.size < 1 || asset.size > MAX_IMAGE_BYTES || !/^[a-f0-9]{64}$/.test(asset.sha256)) throw new InputError('配图素材记录损坏，请重新上传');
  return { ...asset, url: mediaUrl(path.join(dir, 'image.' + extensions[asset.mime])) };
}

export async function listImages(): Promise<ImageAsset[]> {
  const entries = await fs.readdir(directory(), { withFileTypes: true }).catch(() => [] as Dirent[]);
  const images = await Promise.all(entries.filter(entry => entry.isDirectory()).map(entry => getImage(entry.name).catch(() => undefined)));
  return images.filter((asset): asset is StoredImage => !!asset).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function imageIds(project: Project): string[] { return [...new Set(project.scenes.flatMap(scene => scene.cards.flatMap(card => card.image ? [card.image.assetId] : [])))]; }

export async function assertProjectImages(project: Project): Promise<void> {
  const assets = await Promise.all(imageIds(project).map(getImage));
  if (assets.reduce((sum, asset) => sum + asset.size, 0) > MAX_PROJECT_IMAGE_BYTES) throw new InputError('本期配图原文件合计不能超过 60 MB，请减少图片或先缩小图片再上传');
}

/** Resolves the immutable task snapshot, producing an offline/self-contained HTML input. */
export async function resolveImageSources(project: Project): Promise<Record<string, string>> {
  await assertProjectImages(project);
  const sources: Record<string, string> = {};
  for (const id of imageIds(project)) {
    const asset = await getImage(id);
    const file = await insideAssets(path.join(directory(), id, 'image.' + extensions[asset.mime]));
    const stat = await fs.stat(file);
    if (stat.size !== asset.size) throw new InputError(`配图「${asset.name}」已损坏，请重新上传`);
    const bytes = await fs.readFile(file);
    if (digest(bytes) !== asset.sha256) throw new InputError(`配图「${asset.name}」内容已变化，请重新上传`);
    sources[id] = `data:${asset.mime};base64,${bytes.toString('base64')}`;
  }
  return sources;
}
