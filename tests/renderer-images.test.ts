import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { chromium, type Page } from 'playwright';
import { createVideoHtml } from '../src/engine/renderer';
import type { CardImage, Game } from '../src/core/types';
import type { Episode } from '../src/engine/legacy/weekly-episode';

const run = promisify(execFile);
const games: Game[] = ['starrail', 'genshin', 'hi3', 'zzz'];
const layouts: CardImage['layout'][] = ['left', 'right', 'background'];
const settings = { particles: 1, cardScale: 1.2, captionSize: 28 };
const invalidRaster = 'data:image/png;base64,AAAA';
const body = '新版本带来限时活动和全新区域。图片与文字分别布局，支持调整裁切位置与完整展示，让活动主题、参与条件和时间信息保持清晰。';
function illustrated(layout: CardImage['layout'] = 'left'): Episode {
  return {
    title: '手动配图布局测试', period: '配图示例', cutoff: '测试资料', duration: 6, presentation: 'center-focus',
    scenes: [{
      id: 'scene-image', start: 0, duration: 6, kind: 'news', section: '活动资讯', title: '新区域与活动资讯',
      subtitle: '同一张本地图片用于左右图文和背景布局',
      cards: [0, 1, 2].map(index => ({
        label: `活动 ${index + 1}`, title: '开启全新旅程',
        body: body + '本期同时整理了角色消息、活动奖励与社区见闻。请在参与前确认开放时间、解锁要求和领取方式，避免错过限时内容。资料来源与发布日期也会随同卡片保留。',
        image: { assetId: 'landscape', layout, fit: index === 1 ? 'contain' : 'cover', positionX: 72, positionY: 35 },
      })),
      source: '本地测试图', sourceIds: [], transition: 'ticket-wipe',
      focusCues: [{ start: 0, cardIndex: 0 }, { start: 2, cardIndex: 1, transition: 'orbit' }, { start: 4, cardIndex: 2, transition: 'hologram' }],
    }],
    cues: [{ start: 0, end: 6, text: '本地配图与卡片文字同步呈现。' }],
  };
}

async function fixtureImages(page: Page) {
  return page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 360;
    const c = canvas.getContext('2d')!;
    const sky = c.createLinearGradient(0, 0, 0, 360); sky.addColorStop(0, '#90bccc'); sky.addColorStop(1, '#f8e2bb');
    c.fillStyle = sky; c.fillRect(0, 0, 640, 360);
    c.fillStyle = '#fbe9b1'; c.beginPath(); c.arc(462, 92, 40, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#618879'; c.beginPath(); c.moveTo(0, 272); c.lineTo(185, 75); c.lineTo(390, 300); c.lineTo(535, 152); c.lineTo(640, 276); c.lineTo(640, 360); c.lineTo(0, 360); c.fill();
    c.fillStyle = '#355e53'; c.beginPath(); c.moveTo(0, 300); c.lineTo(120, 203); c.lineTo(298, 330); c.lineTo(458, 195); c.lineTo(640, 312); c.lineTo(640, 360); c.lineTo(0, 360); c.fill();
    c.fillStyle = '#c8ddd4'; c.beginPath(); c.moveTo(370, 280); c.lineTo(310, 360); c.lineTo(500, 360); c.lineTo(393, 282); c.fill();
    c.fillStyle = '#edc47e'; c.fillRect(465, 251, 8, 35); c.beginPath(); c.arc(469, 242, 8, 0, Math.PI * 2); c.fill();
    return { png: canvas.toDataURL('image/png'), jpeg: canvas.toDataURL('image/jpeg'), webp: canvas.toDataURL('image/webp') };
  });
}

test('missing images and non-raster/non-data URIs fail before generating HTML', () => {
  const ep = illustrated();
  assert.throws(() => createVideoHtml(ep, { game: 'genshin', ...settings }), /缺少卡片配图/);
  for (const source of ['https://example.com/a.png', 'file:///tmp/a.png', 'javascript:alert(1)', 'data:image/svg+xml;base64,AAAA', 'data:image/gif;base64,AAAA', 'data:image/png;base64,AA"AA', 'data:image/png;base64,', 'data:image/png;base64,AAA']) {
    assert.throws(() => createVideoHtml(ep, { game: 'genshin', ...settings, imageSources: { landscape: source } }), /base64 data URI/);
  }
  ep.scenes[0].cards[0].image!.positionX = Infinity;
  assert.throws(() => createVideoHtml(ep, { game: 'genshin', ...settings, imageSources: { landscape: invalidRaster } }), /布局参数无效/);
});

test('a 12 MiB base64 asset does not recurse and is embedded once when reused', () => {
  const source = 'data:image/png;base64,' + 'A'.repeat(12 * 1024 * 1024 / 3 * 4);
  const html = createVideoHtml(illustrated(), { game: 'starrail', ...settings, imageSources: { landscape: source } });
  assert.ok(html.length < source.length + 100000);
  assert.equal(html.split(source.slice(0, 100)).length - 1, 1);
});

test('every theme/layout decodes offline, fits text beside pictures, and seeks deterministically', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, reducedMotion: 'no-preference' });
    const sources = await fixtureImages(page);
    const errors: string[] = []; const externalRequests: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => { externalRequests.push(route.request().url()); return route.abort(); });
    for (const game of games) for (const layout of layouts) {
      const source = sources[layout === 'left' ? 'png' : layout === 'right' ? 'jpeg' : 'webp'];
      const html = createVideoHtml(illustrated(layout), { game, ...settings, imageSources: { landscape: source } });
      assert.equal(html.split(source).length - 1, 1, 'Shared image data must only be embedded once');
      await page.setContent(html);
      await page.waitForSelector('#viewport[data-ready="true"]');
      await page.evaluate(() => (window as any).__weekly.seek(1));
      assert.equal(await page.locator('img[data-image-state="decoded"]').count(), 3);
      assert.equal(await page.locator('[data-overflow="true"]').count(), 0, `${game}/${layout}: image card overflows`);
      const geometry = await page.locator('.ticket').first().evaluate(el => {
        const image = el.querySelector<HTMLImageElement>('img')!; const picture = el.querySelector('.card-media')!.getBoundingClientRect();
        const copy = el.querySelector('.ticket-copy')!.getBoundingClientRect(); const bounds = el.getBoundingClientRect();
        return { imageWidth: image.naturalWidth, fit: getComputedStyle(image).objectFit, position: getComputedStyle(image).objectPosition,
          separated: picture.right <= copy.left || copy.right <= picture.left,
          contained: copy.left >= bounds.left && copy.right <= bounds.right && copy.top >= bounds.top && copy.bottom <= bounds.bottom,
          shade: getComputedStyle(el.querySelector('.card-image-shade')!).display,
          textColor: getComputedStyle(el.querySelector('p')!).color,
        };
      });
      assert.equal(geometry.imageWidth, 640);
      assert.equal(geometry.fit, 'cover'); assert.equal(geometry.position, '72% 35%');
      assert.ok(geometry.contained, `${game}/${layout}: copy extends beyond the card`);
      if (layout !== 'background') assert.ok(geometry.separated, `${game}/${layout}: copy overlaps its picture`);
      else { assert.equal(geometry.shade, 'block'); assert.equal(geometry.textColor, 'rgb(255, 253, 245)'); }
      await page.evaluate(() => (window as any).__weekly.seek(3));
      assert.equal(await page.locator('.ticket').nth(1).locator('img').evaluate(img => getComputedStyle(img).objectFit), 'contain');
      const state = () => page.locator('.scene').evaluateAll(scenes => scenes.map(scene => ({
        markup: scene.innerHTML,
        canvas: Array.from(scene.querySelectorAll('canvas')).map(canvas => canvas.toDataURL()),
      })));
      const beforeState = await state(); const before = await page.screenshot();
      await page.evaluate(() => { (window as any).__weekly.seek(5); (window as any).__weekly.seek(3); });
      assert.deepEqual(await state(), beforeState, `${game}/${layout}: DOM or Canvas seek is not deterministic`);
      const after = await page.screenshot();
      if (createHash('sha256').update(before).digest('hex') !== createHash('sha256').update(after).digest('hex')) {
        const delta = await page.evaluate(async encoded => {
          const images = await Promise.all(encoded.map(async source => { const image = new Image(); image.src = source; await image.decode(); return image; }));
          const pixels = images.map(image => { const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height; const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0); return context.getImageData(0, 0, image.width, image.height).data; });
          let changed = 0, maximum = 0;
          for (let n = 0; n < pixels[0].length; n += 4) { let difference = 0; for (let channel = 0; channel < 4; channel++) difference = Math.max(difference, Math.abs(pixels[0][n + channel] - pixels[1][n + channel])); if (difference) changed++; maximum = Math.max(maximum, difference); }
          return { changed, maximum };
        }, [before, after].map(buffer => 'data:image/png;base64,' + buffer.toString('base64')));
        // Chromium may round a few translucent transformed edge pixels by 1–2 RGB levels.
        assert.ok(delta.maximum <= 2 && delta.changed <= 1920 * 1080 * .001, `${game}/${layout}: unexpected raster drift ${JSON.stringify(delta)}`);
      }
    }
    assert.deepEqual(errors, []); assert.deepEqual(externalRequests, []);
    const overlong = illustrated(); overlong.scenes[0].cards[0].body = '很长的正文应明确报告溢出。'.repeat(100);
    await page.setContent(createVideoHtml(overlong, { game: 'starrail', ...settings, imageSources: { landscape: sources.png } }));
    await page.waitForSelector('#viewport[data-ready="true"]');
    assert.equal(await page.locator('.ticket').first().getAttribute('data-overflow'), 'true');
  } finally { await browser.close(); }
});

test('corrupt images expose a readable error, never report ready, and prevent export', async () => {
  const html = createVideoHtml(illustrated(), { game: 'starrail', ...settings, imageSources: { landscape: invalidRaster } });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage(); await page.setContent(html);
    await page.waitForSelector('#viewport[data-ready="error"]');
    assert.match(await page.locator('#render-error').textContent() || '', /配图解码失败：landscape/);
    assert.equal(await page.locator('#viewport[data-ready="true"]').count(), 0);
  } finally { await browser.close(); }
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'miyo-image-export-test-'));
  try {
    await fs.writeFile(path.join(directory, 'episode.html'), html);
    await fs.writeFile(path.join(directory, 'episode.json'), JSON.stringify(illustrated()));
    await assert.rejects(run(process.execPath, ['--import', 'tsx', 'scripts/render-video.ts', '--run', directory], { cwd: process.cwd(), timeout: 20000 }), (error: any) => /配图检查未通过/.test(error.stderr));
    const report = JSON.parse(await fs.readFile(path.join(directory, 'image-check.json'), 'utf8'));
    assert.equal(report.expected, 3); assert.equal(report.total, 3); assert.equal(report.failed.length, 3);
    await assert.rejects(fs.access(path.join(directory, 'video.mp4')));
    await assert.rejects(fs.access(path.join(directory, 'video.partial.mp4')));
    const missing = illustrated(); missing.scenes[0].cards.forEach(card => { delete card.image; });
    await fs.writeFile(path.join(directory, 'episode.html'), createVideoHtml(missing, { game: 'starrail', ...settings }));
    await assert.rejects(run(process.execPath, ['--import', 'tsx', 'scripts/render-video.ts', '--run', directory], { cwd: process.cwd(), timeout: 20000 }), (error: any) => /配图检查未通过/.test(error.stderr));
    const missingReport = JSON.parse(await fs.readFile(path.join(directory, 'image-check.json'), 'utf8'));
    assert.equal(missingReport.total, 0); assert.equal(missingReport.missing.length, 3);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
