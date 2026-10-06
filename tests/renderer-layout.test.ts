import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium, type Page } from 'playwright';
import { createVideoHtml } from '../src/engine/renderer';
import type { Game } from '../src/core/types';
import type { Episode } from '../src/engine/legacy/weekly-episode';

const games: Game[] = ['starrail', 'genshin', 'hi3', 'zzz'];
const options = { particles: 1, cardScale: 1.2, captionSize: 48 };
function fixture(): Episode {
  return {
    title: '聚焦卡片尺寸验证', period: '本期资讯', cutoff: '底栏截点原始值', duration: 12, presentation: 'center-focus',
    scenes: [{
      id: 'scene-a', start: 0, duration: 12, section: '活动资讯', kind: 'news', title: '主标题继续呈现',
      kicker: '眉题继续呈现', subtitle: '副标题原始值', source: '来源原始值', sourceIds: ['source-a'],
      cards: [0, 1, 2].map(i => ({ id: `card-${i}`, label: '卡片标签', title: '全新活动即将开启', body: '在全新区域探索旅行的故事，留意开放时间、参与条件与奖励领取方式。每张卡片可以单独调整宽度和高度，画面在当前配音进度即时更新。' })),
      focusCues: [{ start: 0, cardIndex: 0 }, { start: 4, cardIndex: 1, transition: 'orbit' }, { start: 8, cardIndex: 2, transition: 'hologram' }],
    }],
    cues: [{ start: 0, end: 12, text: '最大字幕与章节进度仍然清楚可见。这是一句接近四十个汉字的字幕，用于验证字幕不会折行覆盖章节进度。' }],
  };
}

async function focusedSize(page: Page) {
  return page.locator('.ticket[data-focused="true"]').evaluate(el => {
    const rect = el.getBoundingClientRect();
    return { width: rect.width, height: rect.height, top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right };
  });
}

test('removed annotations remain in data but do not occupy the visible layout', () => {
  const ep = fixture();
  for (const game of games) {
    const html = createVideoHtml(ep, { ...options, game });
    for (const markup of ['class="source"', 'class="scene-subtitle"', 'class="bottom-meta"', 'id="time-label"']) assert.ok(!html.includes(markup), markup);
    const data = JSON.parse(html.match(/<script id="episode-data" type="application\/json">([\s\S]*?)<\/script>/)![1]);
    assert.equal(data.cutoff, ep.cutoff);
    assert.equal(data.scenes[0].source, ep.scenes[0].source);
    assert.deepEqual(data.scenes[0].sourceIds, ep.scenes[0].sourceIds);
    assert.equal(data.scenes[0].subtitle, ep.scenes[0].subtitle);
    assert.ok(html.includes('眉题继续呈现'));
    assert.ok(html.includes('主标题继续呈现'));
  }
  for (const width of [NaN, Infinity, 799, 1721, 1200.5]) {
    ep.scenes[0].cards[0].size = { width, height: 620 };
    assert.throws(() => createVideoHtml(ep, { ...options, game: 'starrail' }), /卡片尺寸无效/);
  }
});

test('four themes use the enlarged stage and exact explicit focus sizes independently of cardScale', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, reducedMotion: 'no-preference' });
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    for (const game of games) {
      await page.setContent(createVideoHtml(fixture(), { ...options, game }));
      await page.waitForSelector('#viewport[data-ready="true"]');
      for (const [i, expected] of [[1440, 620], [1390, 638], [1420, 626]].entries()) {
        await page.evaluate(t => (window as any).__weekly.seek(t), i * 4 + 2);
        const rect = await focusedSize(page);
        assert.equal(rect.width, expected[0], `${game} card ${i} width`);
        assert.equal(rect.height, expected[1], `${game} card ${i} height`);
        assert.ok(rect.top >= 244 && rect.bottom <= 936);
      }
      assert.equal(await page.locator('[data-overflow="true"]').count(), 0);
      assert.ok(await page.evaluate(() => {
        const heading = document.querySelector('.scene-heading')!.getBoundingClientRect();
        const cap = document.querySelector('.captions')!.getBoundingClientRect();
        const captionText = document.querySelector('.captions p') as HTMLElement;
        const textBounds = captionText.getBoundingClientRect();
        const chapters = document.querySelector('.chapters')!.getBoundingClientRect();
        return heading.bottom < 244 && cap.top === 948 && cap.bottom <= chapters.top && chapters.bottom < 1080
          && textBounds.top >= cap.top && textBounds.bottom <= cap.bottom && captionText.scrollWidth <= captionText.clientWidth + 1;
      }));
      for (const scale of [.7, 1.2]) {
        const ep = fixture();
        ep.scenes[0].cards[0].size = { width: 1720, height: 660 };
        ep.scenes[0].cards[1].size = { width: 800, height: 360 };
        ep.scenes[0].cards[1].body = '最小卡片仍可清晰阅读。';
        await page.setContent(createVideoHtml(ep, { ...options, game, cardScale: scale }));
        await page.waitForSelector('#viewport[data-ready="true"]');
        await page.evaluate(() => (window as any).__weekly.seek(2));
        assert.deepEqual(await focusedSize(page), { width: 1720, height: 660, top: 260, bottom: 920, left: 100, right: 1820 });
        await page.evaluate(() => (window as any).__weekly.seek(6));
        assert.deepEqual(await focusedSize(page), { width: 800, height: 360, top: 410, bottom: 770, left: 560, right: 1360 });
        assert.equal(await page.locator('.ticket[data-card="1"]').getAttribute('data-overflow'), 'false');
      }
    }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('same-origin parent resizes cards without reload, image decode, or a time change; invalid messages are ignored', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    const source = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 100; c.height = 100; return c.toDataURL(); });
    const ep = fixture();
    ep.scenes[0].cards[0].image = { assetId: 'fixture', layout: 'left', fit: 'cover', positionX: 50, positionY: 50 };
    const html = createVideoHtml(ep, { ...options, game: 'starrail', imageSources: { fixture: source } });
    await page.route('http://layout.test/**', route => route.fulfill({ contentType: 'text/html', body: route.request().url().endsWith('/frame') ? html : '<iframe src="/frame" width="1920" height="1080"></iframe>' }));
    await page.goto('http://layout.test/');
    const frame = page.frames().find(f => f.url().endsWith('/frame'))!;
    await frame.waitForSelector('#viewport[data-ready="true"]');
    await frame.evaluate(() => { (window as any).__weekly.seek(2.125); (window as any).originalImage = document.querySelector('img'); });
    const post = (width: number, height: number) => page.evaluate(size => document.querySelector('iframe')!.contentWindow!.postMessage({ type: 'moyo:card-sizes', sizes: [{ sceneId: 'scene-a', cardId: 'card-0', ...size }] }, location.origin), { width, height });
    await post(800, 360);
    await frame.waitForFunction(() => (document.querySelector('.ticket') as HTMLElement).offsetWidth === 800);
    const smallFont = await frame.locator('.ticket p').first().evaluate(el => Number.parseFloat(getComputedStyle(el).fontSize));
    await post(1720, 660);
    await frame.waitForFunction(() => (document.querySelector('.ticket') as HTMLElement).offsetWidth === 1720);
    const largeFont = await frame.locator('.ticket p').first().evaluate(el => Number.parseFloat(getComputedStyle(el).fontSize));
    assert.ok(largeFont > smallFont, 'Growing a card restores its readable base font');
    for (const width of [NaN, Infinity, 799, 1721, 1200.5]) await post(width, 620);
    await frame.evaluate(() => {
      const sizes = [{ sceneId: 'scene-a', cardId: 'card-0', width: 900, height: 400 }];
      window.dispatchEvent(new MessageEvent('message', { source: window, origin: location.origin, data: { type: 'moyo:card-sizes', sizes } }));
      window.dispatchEvent(new MessageEvent('message', { source: window.parent, origin: 'http://foreign.test', data: { type: 'moyo:card-sizes', sizes } }));
    });
    const state = await frame.evaluate(() => ({
      time: (document.querySelector('#viewport') as HTMLElement).dataset.time,
      playing: (document.querySelector('#viewport') as HTMLElement).dataset.playing,
      width: (document.querySelector('.ticket') as HTMLElement).offsetWidth,
      height: (document.querySelector('.ticket') as HTMLElement).offsetHeight,
      imageUnchanged: document.querySelector('img') === (window as any).originalImage,
      imageState: (document.querySelector('img') as HTMLElement).dataset.imageState,
    }));
    assert.deepEqual(state, { time: '2.125', playing: 'false', width: 1720, height: 660, imageUnchanged: true, imageState: 'decoded' });
    await frame.evaluate(() => { (window as any).__weekly.seek(10); (window as any).__weekly.seek(2.125); });
    assert.equal(await frame.locator('.ticket[data-card="0"]').evaluate(el => el.getBoundingClientRect().width), 1720);
    assert.equal(await frame.locator('.ticket[data-card="0"]').getAttribute('data-overflow'), 'false');
  } finally { await browser.close(); }
});
