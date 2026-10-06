import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createVideoHtml } from '../src/engine/renderer';
import type { Game } from '../src/core/types';
import type { Episode } from '../src/engine/legacy/weekly-episode';

const games: Game[] = ['starrail', 'genshin', 'hi3', 'zzz'];
const options = (game: Game) => ({ game, particles: 1, cardScale: 1.2, captionSize: 28 });
function episode(cardCount = 3, duration = 10): Episode {
  return {
    title: '测试周报', period: '历史示例', cutoff: '2026-10-02', duration, presentation: 'center-focus',
    scenes: [0, 1].map(index => ({
      id: `scene-${index}`, start: index * duration / 2, duration: duration / 2, section: `章节 ${index + 1}`,
      kind: index ? 'news' : 'intro', title: '本期资讯与活动', subtitle: '测试确定性画面与章节切换',
      cards: Array.from({ length: cardCount }, (_, n) => ({ label: `资讯 ${n + 1}`, title: `卡片 ${n + 1}`, body: '内容保持清晰可读，配音时间决定画面节奏。' })),
      source: '项目测试资料', sourceIds: ['source-1'], transition: 'ticket-wipe',
      focusCues: Array.from({ length: cardCount }, (_, n) => ({ start: (duration / 2) * n / cardCount, cardIndex: n, transition: 'classic' })),
    })),
    cues: [{ start: 0, end: duration, text: '这是与配音时间一致的测试字幕。' }],
  };
}

test('all themes escape user markup, preserve data, and accept positive durations', () => {
  const draft = episode(1, .04);
  const untrusted = '</script><img src=x onerror="window.INJECTED=1">\u2028<&"';
  draft.title = untrusted;
  draft.scenes[0].cards[0].body = untrusted;
  for (const game of games) {
    const html = createVideoHtml(draft, options(game));
    assert.ok(!html.includes('<img src=x'));
    const encoded = html.match(/<script id="episode-data" type="application\/json">([\s\S]*?)<\/script>/)![1];
    assert.equal(JSON.parse(encoded).scenes[0].cards[0].body, untrusted);
    const runtime = html.match(/<script>([\s\S]*?)<\/script>/)![1];
    assert.doesNotThrow(() => new Function(runtime));
    assert.ok(html.includes(`data-game="${game}"`));
    if (game !== 'starrail') assert.ok(!html.includes('星穹列车'));
  }
  assert.throws(() => createVideoHtml(episode(), { ...options('genshin'), fontDataUri: '");}</style><script>bad()</script>' }), /base64 font/);
  const emptyCards = episode(); emptyCards.scenes[0].cards = [];
  assert.throws(() => createVideoHtml(emptyCards, options('starrail')), /one to six cards/);
});

test('themes render one to six cards, deterministic seeks, particles and captions without script errors', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, reducedMotion: 'no-preference' });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const samples = new Map<string, string>();
    for (const game of games) {
      for (let count = 1; count <= 6; count++) {
        await page.setContent(createVideoHtml(episode(count), { ...options(game), captionSize: 48 }));
        await page.waitForSelector('#viewport[data-ready="true"]');
        await page.evaluate(() => (window as any).__weekly.seek(2.2));
        assert.equal(await page.locator('.scene').first().locator('.ticket').count(), count);
        assert.equal(await page.locator('.ticket[data-overflow="true"]').count(), 0, `${game}: ${count} cards overflow`);
        const state = await page.evaluate(() => {
          const nav = document.querySelector('.chapters')!.getBoundingClientRect();
          const cap = document.querySelector('.captions')!.getBoundingClientRect();
          return { captionClear: cap.bottom <= nav.top, time: document.querySelector('#viewport')!.getAttribute('data-time') };
        });
        assert.equal(state.time, '2.200');
        assert.ok(state.captionClear, `${game}: caption intersects chapters`);
      }
      await page.evaluate(() => (window as any).__weekly.seek(5.45));
      const curtain = Number(await page.locator('#transition').evaluate(el => getComputedStyle(el).opacity));
      assert.equal(curtain > 0, game === 'starrail', 'Only Star Rail uses the preserved golden ticket curtain');
      const canvas = () => page.evaluate(() => (document.querySelector('#focus-transition') as HTMLCanvasElement).toDataURL());
      const before = await canvas();
      await page.evaluate(() => { (window as any).__weekly.seek(8); (window as any).__weekly.seek(5.45); });
      assert.equal(await canvas(), before, `${game}: seek was not deterministic`);
      samples.set(game, before);
      await page.setContent(createVideoHtml(episode(), { ...options(game), particles: 0 }));
      await page.waitForSelector('#viewport[data-ready="true"]');
      const empty = await page.evaluate(() => {
        const canvas = document.querySelector('#starfield') as HTMLCanvasElement;
        return !canvas.getContext('2d')!.getImageData(0, 0, 1920, 1080).data.some(Boolean);
      });
      assert.ok(empty, `${game}: particles=0 leaves ambient pixels`);
    }
    assert.equal(new Set(samples.values()).size, 4, 'Each game needs a different chapter transition');
    const many = episode();
    many.duration = 30;
    many.scenes = Array.from({ length: 30 }, (_, index) => ({ ...many.scenes[0], id: `chapter-${index}`, section: `很长的自定义章节名称 ${index}`, start: index, duration: 1, focusCues: [{ start: 0, cardIndex: 0 }] }));
    await page.setContent(createVideoHtml(many, options('hi3')));
    await page.waitForSelector('#viewport[data-ready="true"]');
    assert.ok(await page.locator('.chapters').evaluate(el => el.scrollWidth <= el.clientWidth));
    for (let count = 1; count <= 6; count++) {
      const grid = episode(count); delete grid.presentation;
      await page.setContent(createVideoHtml(grid, options('genshin')));
      await page.waitForSelector('#viewport[data-ready="true"]');
      assert.equal(await page.locator('.ticket[data-overflow="true"]').count(), 0, `Grid: ${count} cards overflow`);
    }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('iframe messages drive time while embedded clicks never start an independent clock', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    // A same-origin parent and preview, equivalent to the API route in the studio.
    const html = createVideoHtml(episode(), options('genshin'));
    await page.route('http://renderer.test/**', route => route.fulfill({ contentType: 'text/html', body: route.request().url().endsWith('/frame') ? html : '<script>window.messages=[];addEventListener("message",e=>messages.push(e.data))</script><iframe src="/frame" width="1920" height="1080"></iframe>' }));
    await page.goto('http://renderer.test/');
    const iframe = page.frames().find(frame => frame.url().endsWith('/frame'))!;
    await iframe.waitForSelector('#viewport[data-ready="true"]');
    await page.waitForFunction(() => (window as any).messages.some((message: any) => message.type === 'moyo:ready'));
    await page.evaluate(() => document.querySelector('iframe')!.contentWindow!.postMessage({ type: 'moyo:seek', time: 3.125 }, location.origin));
    await iframe.waitForFunction(() => document.querySelector('#viewport')!.getAttribute('data-time') === '3.125');
    await iframe.evaluate(() => window.dispatchEvent(new MessageEvent('message', { source: window, origin: location.origin, data: { type: 'moyo:seek', time: 9 } })));
    assert.equal(await iframe.locator('#viewport').getAttribute('data-time'), '3.125', 'Messages from the iframe itself are not trusted');
    await iframe.locator('.brand').click();
    await page.waitForFunction(() => (window as any).messages.some((message: any) => message.type === 'moyo:toggle'));
    await iframe.locator('.chapter').last().click();
    await page.waitForFunction(() => (window as any).messages.some((message: any) => message.type === 'moyo:jump' && message.time === 5));
    assert.equal(await iframe.locator('#viewport').getAttribute('data-playing'), 'false');
    assert.equal(await iframe.locator('#viewport').getAttribute('data-time'), '3.125');
  } finally { await browser.close(); }
});
