import { STAR_RAIL_TRANSITION_RUNTIME, type StarRailTransition, type StarRailSceneTransition } from './starrail-transitions';
import type { CardImage, CardSize } from '../../core/types';
import { CARD_SIZE_LIMITS, getCardSize } from '../../core/card-layout';

/** A seekable, self-contained weekly bulletin. Every motion is a function of seconds. */
export interface EpisodeScene {
  id: string;
  start: number;
  duration: number;
  section: string;
  title: string;
  subtitle?: string;
  kind: 'intro' | 'news' | 'event' | 'community' | 'outro';
  kicker?: string;
  metric?: string;
  cards: Array<{ id?: string; label: string; title: string; body: string; image?: CardImage; size?: CardSize }>;
  source: string;
  sourceIds: string[];
  transition?: StarRailSceneTransition;
  /** Local scene times tied to narration, rather than an automatic carousel. */
  focusCues?: Array<{ start: number; cardIndex: number; transition?: StarRailTransition }>;
}

export interface Episode {
  title: string;
  period: string;
  cutoff: string;
  duration: number;
  presentation?: 'center-focus';
  scenes: EpisodeScene[];
  cues: Array<{ start: number; end: number; text: string }>;
}

/** Code-owned theme hooks. User content must only enter through Episode. */
export interface EpisodeTheme {
  id: 'starrail' | 'genshin' | 'hi3' | 'zzz';
  brand: string;
  tagline: string;
  emblem: string;
  curtainLabel: string;
  css: string;
  runtime: string;
}
export interface EpisodeOptions {
  fontDataUri?: string;
  theme?: EpisodeTheme;
  particles?: number;
  cardScale?: number;
  captionSize?: number;
  imageSources?: Record<string, string>;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

/** No external URL or markup enters an image source, even in a saved offline HTML. */
function imageSource(image: CardImage, sources: Record<string, string>, validatedSource?: string): string {
  if (!['left', 'right', 'background'].includes(image.layout) || !['cover', 'contain'].includes(image.fit)
    || !Number.isFinite(image.positionX) || !Number.isFinite(image.positionY)
    || image.positionX < 0 || image.positionX > 100 || image.positionY < 0 || image.positionY > 100) {
    throw new Error(`配图布局参数无效：${image.assetId}`);
  }
  if (validatedSource !== undefined) return validatedSource;
  if (!Object.hasOwn(sources, image.assetId)) throw new Error(`缺少卡片配图：${image.assetId}`);
  const uri = sources[image.assetId];
  const separator = typeof uri === 'string' ? uri.indexOf(',') : -1;
  const header = separator >= 0 ? uri.slice(0, separator) : '';
  const payload = separator >= 0 ? uri.slice(separator + 1) : '';
  const paddingAt = payload.indexOf('=');
  const encoded = paddingAt < 0 ? payload : payload.slice(0, paddingAt);
  const padding = paddingAt < 0 ? '' : payload.slice(paddingAt);
  // A repeated-group regex can overflow V8's stack on a valid multi-MiB image.
  // Scan its alphabet once and inspect padding separately instead.
  if (!['data:image/png;base64', 'data:image/jpeg;base64', 'data:image/webp;base64'].includes(header)
    || !encoded.length || payload.length % 4 !== 0 || /[^A-Za-z0-9+/]/.test(encoded)
    || (padding !== '' && padding !== '=' && padding !== '==')) {
    throw new Error(`配图必须是 PNG、JPEG 或 WebP 的 base64 data URI：${image.assetId}`);
  }
  return uri;
}

function sceneMarkup(scene: EpisodeScene, index: number, emblem: string, defaultMetric: string, cardScale: number): string {
  const cards = scene.cards.map((card, cardIndex) => {
    const compact = card.body.length > 100 ? ' compact' : '';
    const size = getCardSize(card, cardIndex, cardScale);
    const text = `<div class="ticket-top"><span>${escapeHtml(card.label)}</span><span class="ticket-number">${String(cardIndex + 1).padStart(2, '0')}</span></div>
      <h2>${escapeHtml(card.title)}</h2><p>${escapeHtml(card.body)}</p>`;
    const content = card.image ? `<figure class="card-media"><img class="card-image" alt="" draggable="false" decoding="async" data-asset-id="${escapeHtml(card.image.assetId)}" data-image-state="loading" style="object-fit:${card.image.fit};object-position:${card.image.positionX}% ${card.image.positionY}%"></figure><div class="card-image-shade" aria-hidden="true"></div><div class="ticket-copy">${text}</div>` : text;
    return `<article class="ticket ticket-${cardIndex + 1}${compact}${card.image ? ` has-image image-${card.image.layout}` : ''}" data-card="${cardIndex}"${card.id ? ` data-card-id="${escapeHtml(card.id)}"` : ''} style="--card-width:${size.width}px;--card-height:${size.height}px"${card.image ? ` data-image-layout="${card.image.layout}"` : ''}>
      ${content}
      <div class="ticket-track"><i></i><b></b><i></i></div><canvas class="card-fx" aria-hidden="true"></canvas>
    </article>`;
  }).join('');
  return `<section class="scene ${escapeHtml(scene.kind)} cards-${scene.cards.length}" data-scene="${index}" aria-label="${escapeHtml(scene.title)}">
    <div class="scene-heading">
      <div class="kicker"><span class="chapter-index">${String(index + 1).padStart(2, '0')}</span>${escapeHtml(scene.kicker || scene.section)}</div>
      <h1>${escapeHtml(scene.title)}</h1>
    </div>
    <div class="scene-emblem" aria-hidden="true"><div class="orbit orbit-one"></div><div class="orbit orbit-two"></div><span>${escapeHtml(scene.metric || defaultMetric)}</span><small>${escapeHtml(emblem)}</small></div>
    <div class="cards">${cards}</div>
  </section>`;
}

const CSS = `
*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#080e20}
body{font-family:EpisodeFont,"PingFang SC","Microsoft YaHei",sans-serif;color:#f5f1e9;-webkit-font-smoothing:antialiased}
button{font:inherit}#viewport{position:absolute;left:50%;top:50%;width:1920px;height:1080px;transform-origin:center;overflow:hidden;background:#0b1125;isolation:isolate}
.background{position:absolute;inset:0;background:radial-gradient(ellipse at 82% 45%,#1e3150 0%,transparent 52%),linear-gradient(115deg,#0b1125 28%,#101d35 100%)}
.background:before{content:"";position:absolute;inset:0;background-image:linear-gradient(#8ab0ca08 1px,transparent 1px),linear-gradient(90deg,#8ab0ca08 1px,transparent 1px);background-size:96px 96px;mask-image:linear-gradient(90deg,transparent,#000)}
.background:after{content:"";position:absolute;inset:0;border:26px solid #070d1b;opacity:.5}
#starfield{position:absolute;inset:0;width:1920px;height:1080px;pointer-events:none;opacity:.78}
.brand{position:absolute;left:92px;top:44px;display:flex;align-items:center;gap:18px;z-index:8}
.brand-mark{width:35px;height:35px;border:1px solid #d8b778;transform:rotate(45deg);position:relative}
.brand-mark:before,.brand-mark:after{content:"";position:absolute;background:#d8b778}.brand-mark:before{width:1px;height:51px;left:16px;top:-9px}.brand-mark:after{width:51px;height:1px;left:-9px;top:16px}
.brand b{font-size:25px;font-weight:600;letter-spacing:3px}.brand small{display:block;margin-top:4px;color:#8eabc2;font-size:12px;letter-spacing:4px}
.period{position:absolute;right:92px;top:50px;text-align:right;z-index:8;color:#d9bd83;font:23px/1.3 EpisodeFont,sans-serif;letter-spacing:2px}.period small{display:block;margin-top:7px;font-size:13px;color:#7f9bb3;letter-spacing:3px}
.chapters{position:absolute;left:92px;right:92px;top:115px;display:flex;gap:25px;z-index:8;border-top:1px solid #8dc9e52c;padding-top:18px}
.chapter{position:relative;border:0;background:none;color:#778da4;text-align:left;padding:0 0 11px;flex:1;font-size:17px;letter-spacing:1px;cursor:pointer;outline-offset:5px}
.chapter:before{content:"";display:inline-block;width:6px;height:6px;border:1px solid currentColor;transform:rotate(45deg);margin-right:13px;vertical-align:3px}
.chapter.active{color:#e7c788}.chapter.passed{color:#91b3c9}.chapter-progress{position:absolute;left:0;bottom:0;height:2px;width:100%;transform-origin:left;background:#e4c586;transform:scaleX(0)}
.scene{position:absolute;inset:0;visibility:hidden;opacity:0;pointer-events:none}
.scene-heading{position:absolute;left:92px;right:100px;top:191px;z-index:2}
.kicker{display:flex;align-items:center;gap:14px;color:#85cfe9;font-size:18px;letter-spacing:3px;font-weight:500}
.chapter-index{font-size:16px;color:#dabc7b;letter-spacing:1px;border:1px solid #dabc7b55;padding:5px 8px}
h1{font-size:61px;line-height:1.16;font-weight:650;letter-spacing:1px;margin:17px 0 13px;max-width:1500px;text-wrap:balance;white-space:pre-line}
.scene-subtitle{margin:0;font-size:25px;line-height:1.4;color:#a4bdd0;max-width:1470px;letter-spacing:.3px}
.cards{position:absolute;left:92px;right:92px;top:386px;height:486px;display:grid;grid-template-columns:repeat(12,minmax(0,1fr));grid-template-rows:1fr 1fr;gap:22px;z-index:2}
.ticket{position:relative;padding:27px 34px 32px;overflow:hidden;border:1px solid #95cfe04a;background:linear-gradient(115deg,#1b3150f5,#111f36f7);clip-path:polygon(0 0,calc(100% - 15px) 0,100% 15px,100% 100%,15px 100%,0 calc(100% - 15px));border-radius:0;color:#eaf2fa}
.ticket-top{display:flex;justify-content:space-between;align-items:center;gap:10px;position:relative;z-index:1;color:#8bd5ef;font-size:18px;letter-spacing:2px;font-weight:500}
.ticket-number{font-family:monospace;font-size:17px;opacity:.7}.ticket h2{position:relative;z-index:1;font-size:35px;line-height:1.3;letter-spacing:.3px;margin:16px 0 16px;font-weight:650}.ticket p{position:relative;z-index:1;font-size:26px;line-height:1.65;margin:0;color:#b9d0e2;white-space:pre-line;overflow-wrap:anywhere}.ticket.compact p{font-size:24px}
.ticket-track{position:absolute;bottom:17px;left:34px;right:34px;height:5px;display:flex;align-items:center;gap:0;opacity:.6}.ticket-track i{width:5px;height:5px;background:#7ed9f7;transform:rotate(45deg)}.ticket-track b{display:block;height:1px;flex:1;background:linear-gradient(90deg,#7ed9f744,#daba7580)}
.card-fx{position:absolute;inset:0;pointer-events:none;width:100%;height:100%;opacity:.7}
.ticket-1{grid-column:1/8;grid-row:1/3;padding:37px 43px;background:linear-gradient(120deg,#ead3a2,#d4ad69);color:#101e34;border-color:#f6dea8}
.ticket-1 .ticket-top{color:#655132}.ticket-1 h2{font-size:46px;margin:27px 0 25px;line-height:1.22;max-width:92%}.ticket-1 p{font-size:31px;line-height:1.7;color:#314052;max-width:96%}.ticket-1.compact p{font-size:27px}.ticket-1 .ticket-track{left:43px;right:43px}.ticket-1 .ticket-track i{background:#536b72}.ticket-1 .ticket-track b{background:#52637177}
.ticket-2{grid-column:8/13;grid-row:1}.ticket-3{grid-column:8/13;grid-row:2}
.ticket-2 h2,.ticket-3 h2{font-size:31px;margin:12px 0 10px}.ticket-2 p,.ticket-3 p{font-size:24px;line-height:1.45}
.ticket-2{background:linear-gradient(115deg,#182942,#192a49)}.ticket-3{background:linear-gradient(120deg,#142536,#10253a)}
.scene-emblem{position:absolute;right:117px;top:172px;width:206px;height:171px;opacity:.14;color:#bddaf7;display:none;align-items:center;justify-content:center;flex-direction:column;z-index:1}.scene-emblem span{font-family:monospace;font-size:53px;font-weight:400;letter-spacing:-2px}.scene-emblem small{font-size:10px;letter-spacing:3px;position:absolute;bottom:21px}.orbit{position:absolute;border:1px solid #9de8f4;border-radius:50%;width:200px;height:100px}.orbit-one{transform:rotate(-25deg)}.orbit-two{transform:rotate(50deg)}
.intro .scene-heading,.outro .scene-heading{top:216px;right:430px}.intro h1,.outro h1{font-size:88px;line-height:1.15;max-width:1290px;margin:24px 0}.intro .scene-subtitle,.outro .scene-subtitle{font-size:27px;max-width:1200px;line-height:1.5}.intro .scene-emblem,.outro .scene-emblem{display:flex;right:105px;top:250px;width:300px;height:230px;opacity:.8}.intro .orbit,.outro .orbit{width:300px;height:155px}.intro .scene-emblem span,.outro .scene-emblem span{font-size:69px}.intro .scene-emblem small,.outro .scene-emblem small{bottom:20px;font-size:13px}
.intro .cards,.outro .cards{top:616px;height:253px;grid-template-rows:1fr;gap:22px}
.intro .ticket,.outro .ticket{grid-row:1;padding:26px 30px}.intro .ticket-1,.outro .ticket-1{grid-column:1/6}.intro .ticket-2,.outro .ticket-2{grid-column:6/10}.intro .ticket-3,.outro .ticket-3{grid-column:10/13}.intro .ticket h2,.outro .ticket h2{font-size:31px;margin:15px 0 10px}.intro .ticket p,.outro .ticket p{font-size:24px;line-height:1.5}.intro .ticket-1 p,.outro .ticket-1 p{max-width:100%}
.event .ticket-1{grid-column:1/9;grid-row:1/3;background:linear-gradient(112deg,#f0ddb4,#cfac6e);padding-right:160px}.event .ticket-1:after{content:"";position:absolute;right:110px;top:0;bottom:0;border-left:2px dashed #5d543944}.event .ticket-1 .ticket-number{position:absolute;right:-116px;top:98px;font-size:60px;writing-mode:vertical-rl;opacity:.6}.event .ticket-1 p{font-size:30px}.event .ticket-2,.event .ticket-3{grid-column:9/13}.event .ticket-2 p,.event .ticket-3 p{font-size:23px}.event .scene-emblem{display:flex;right:96px;top:168px;opacity:.25}.event h1{max-width:1430px}
.community .cards{grid-template-columns:repeat(12,minmax(0,1fr));grid-template-rows:1fr;gap:24px}.community .ticket{grid-row:1}.community .ticket-1{grid-column:1/6;background:linear-gradient(120deg,#183854,#12263f);border-color:#7ed9f777;color:#e7f5ff}.community .ticket-1 .ticket-top{color:#8bd5ef}.community .ticket-1 h2{font-size:41px}.community .ticket-1 p{font-size:28px;color:#b7cedf;line-height:1.65}.community .ticket-2{grid-column:6/10;margin-top:33px;background:linear-gradient(130deg,#e1cfaa,#bf9e68);color:#15273a;padding-top:32px}.community .ticket-2 .ticket-top{color:#6c5431}.community .ticket-2 p{color:#263b4b}.community .ticket-3{grid-column:10/13;margin-top:76px;padding-left:25px;padding-right:25px}.community .ticket-2 h2,.community .ticket-3 h2{font-size:32px;margin:23px 0}.community .ticket-2 p,.community .ticket-3 p{font-size:25px;line-height:1.65}
.cards-1 .ticket-1{grid-column:1/13;grid-row:1/3}.cards-2 .ticket-1{grid-column:1/8;grid-row:1/3}.cards-2 .ticket-2{grid-column:8/13;grid-row:1/3}.cards-2 .ticket-2 h2{font-size:38px;margin:26px 0}.cards-2 .ticket-2 p{font-size:29px;line-height:1.7}
.cards-4 .cards,.cards-5 .cards,.cards-6 .cards{grid-template-columns:repeat(12,minmax(0,1fr));grid-template-rows:1fr 1fr}.cards-4 .ticket,.cards-5 .ticket,.cards-6 .ticket{grid-column:auto;grid-row:auto;padding:24px 30px;margin:0}.cards-4 .ticket{grid-column:span 6}.cards-5 .ticket,.cards-6 .ticket{grid-column:span 4}.cards-4 .ticket h2,.cards-5 .ticket h2,.cards-6 .ticket h2{font-size:30px;margin:12px 0}.cards-4 .ticket p,.cards-5 .ticket p,.cards-6 .ticket p{font-size:23px;line-height:1.45}.cards-5 .ticket-1{grid-column:span 8}.cards-5 .ticket-2{grid-column:span 4}
.source{position:absolute;left:94px;right:94px;top:902px;display:flex;gap:18px;align-items:flex-start;min-height:47px;border-top:1px solid #85b8d32f;padding-top:13px;font-size:18px;line-height:1.5;color:#92aec3;z-index:3}.source>span{color:#c5ae81;flex:none;letter-spacing:1px}.source p{margin:0;overflow-wrap:anywhere}
.bottom-meta{position:absolute;left:94px;right:94px;top:951px;display:flex;justify-content:space-between;font-size:14px;color:#5e7a94;letter-spacing:1px;z-index:5}.bottom-meta strong{font-family:monospace;color:#88a5bf;font-weight:400}
.captions{position:absolute;left:110px;right:110px;top:980px;height:62px;display:flex;align-items:center;justify-content:center;z-index:30;pointer-events:none;gap:19px;background:#070d1bdb;border-left:3px solid #d5b575;border-right:3px solid #d5b575;padding:7px 26px;opacity:0}
.captions p{font-size:30px;line-height:1.45;margin:0;text-align:center;color:#fffef5;text-shadow:0 1px 2px #000;font-weight:500;min-width:0;max-width:100%;white-space:nowrap}
#transition{position:absolute;inset:0;pointer-events:none;z-index:22;opacity:0;overflow:hidden}
.transit-panel{position:absolute;left:-550px;top:-180px;width:590px;height:1500px;transform:skewX(-17deg);background:linear-gradient(90deg,transparent,#9bdaf222 12%,#b7e8f644 16%,#bfeaffdd 18%,#c5a366f5 20%,#debc83fa 82%,#75cfe099 84%,transparent 85%)}
.transit-panel:before{content:"";position:absolute;left:120px;right:120px;top:130px;bottom:130px;border:2px dashed #394b5755}.transit-panel:after{content:attr(data-label);position:absolute;left:176px;top:380px;writing-mode:vertical-rl;color:#233447;font-size:31px;letter-spacing:7px}
.transit-flash{position:absolute;inset:0;background:radial-gradient(ellipse at 75% 50%,#b6ebff1c,transparent 65%)}
#global-progress{position:absolute;left:0;bottom:0;right:0;height:3px;transform-origin:left;transform:scaleX(0);background:#d3b16f;z-index:31}
#focus-transition{position:absolute;inset:0;width:1920px;height:1080px;pointer-events:none;z-index:23}
.center-focus .cards{overflow:hidden;clip-path:inset(244px 0 144px)}
.center-focus .captions{top:948px;height:54px;padding:6px 26px}
.center-focus .captions p{font-size:28px}
.center-focus .chapters{top:1020px;padding-top:12px}
.center-focus .chapter{font-size:16px;line-height:1.4;padding-bottom:8px}
.center-focus .scene .scene-heading{top:145px;right:240px;z-index:5}
.center-focus .scene h1{font-size:34px;line-height:1.2;white-space:normal;max-width:1450px;margin:11px 0 7px;letter-spacing:.5px}
.center-focus .scene .kicker{font-size:15px;letter-spacing:2px}
.center-focus .scene .scene-emblem{display:flex;right:104px;top:139px;width:150px;height:105px;opacity:.28}
.center-focus .scene .scene-emblem span{font-size:30px;letter-spacing:-1px}
.center-focus .scene .scene-emblem small{bottom:7px;font-size:8px;letter-spacing:2px}
.center-focus .scene .orbit{width:140px;height:70px}
.center-focus .scene .cards{display:block;left:0;right:0;top:0;height:1080px;z-index:3;perspective:3000px;perspective-origin:50% 590px}
.center-focus .scene .ticket{--card-width:1440px;--card-height:620px;position:absolute;left:50%;top:590px;width:var(--card-width);height:var(--card-height);margin-left:calc(var(--card-width) / -2);margin-top:calc(var(--card-height) / -2);padding:37px 46px 38px;transform-origin:center}
.center-focus .scene .ticket-top{font-size:20px;letter-spacing:2px}
.center-focus .scene .ticket-number{position:static;writing-mode:horizontal-tb;font-size:18px}
.center-focus .scene .ticket h2{font-size:60px;line-height:1.2;margin:21px 0 19px;max-width:100%;letter-spacing:1px}
.center-focus .scene .ticket p{font-size:37px;line-height:1.65;max-width:100%}
.center-focus .scene .ticket-track{left:46px;right:46px;bottom:22px}
.center-focus .scene.event .ticket-1:after{display:none}
`;

/** Only image cards opt into this layout; original text cards keep their exact styling. */
const IMAGE_CSS = `
#viewport .ticket.has-image{padding:0;isolation:isolate}
#viewport .ticket.has-image:before{z-index:4;pointer-events:none}
#viewport .ticket.has-image:after{display:none}
#viewport .ticket.has-image .card-media{position:absolute;left:16px;top:16px;bottom:25px;width:41%;margin:0;overflow:hidden;background:#07111b33;border:1px solid currentColor;border-color:#85958744;z-index:0}
#viewport .ticket.has-image .card-image{display:block;width:100%;height:100%;max-width:none}
#viewport .ticket.has-image .ticket-copy{position:absolute;left:calc(41% + 43px);right:34px;top:30px;bottom:34px;z-index:2;min-width:0;overflow:visible}
#viewport .ticket.has-image .ticket-top{font-size:17px;line-height:1.35;gap:12px;letter-spacing:1px}
#viewport .ticket.has-image .ticket-top>span:first-child{overflow-wrap:anywhere;min-width:0}
#viewport .ticket.has-image .ticket-number{position:static;writing-mode:horizontal-tb;font-size:16px;flex:none}
#viewport .ticket.has-image .ticket-copy h2{max-width:100%;font-size:38px;line-height:1.25;margin:16px 0 14px;overflow-wrap:anywhere}
#viewport .ticket.has-image .ticket-copy p{max-width:100%;font-size:26px;line-height:1.5;margin:0;overflow-wrap:anywhere}
#viewport.center-focus .ticket.has-image .ticket-copy h2{font-size:46px}
#viewport.center-focus .ticket.has-image .ticket-copy p{font-size:31px}
#viewport .ticket.has-image .card-image-shade{display:none}
#viewport .ticket.has-image .card-fx{z-index:3;pointer-events:none}
#viewport .ticket.has-image .ticket-track{z-index:3}
#viewport .ticket.image-right .card-media{left:auto;right:16px}
#viewport .ticket.image-right .ticket-copy{left:34px;right:calc(41% + 43px)}
#viewport .ticket.image-background .card-media{inset:0;width:auto;border:0;background:#111b26}
#viewport .ticket.image-background .card-image-shade{display:block;position:absolute;inset:0;z-index:1;background:linear-gradient(90deg,#081421f5 0%,#0a1721ed 34%,#0a17218a 64%,#0a172112 100%)}
#viewport .ticket.image-background .ticket-copy{left:36px;right:42%;top:30px;bottom:34px}
#viewport .ticket.image-background .ticket-copy h2,#viewport .ticket.image-background .ticket-copy p{color:#fffdf5;text-shadow:0 1px 3px #0008}
#viewport .ticket.image-background .ticket-top{color:#eddfbf}
#viewport[data-game="genshin"] .ticket.has-image .card-media{border-radius:3px 12px 3px 8px;border-color:#79946666;background-color:#d7dfc8}
#viewport[data-game="genshin"] .ticket.image-background .card-image-shade{background:linear-gradient(90deg,#1c342af5 0%,#20392ef0 32%,#29473799 63%,#2947370a 100%)}
#viewport[data-game="hi3"] .ticket.has-image .card-media{border-color:#c6ad8466;clip-path:polygon(0 10px,12px 0,100% 0,100% calc(100% - 10px),calc(100% - 12px) 100%,0 100%)}
#viewport[data-game="hi3"] .ticket.image-background .card-image-shade{background:linear-gradient(90deg,#161a32fa 0%,#1c203aee 34%,#24233d99 63%,#24233d11 100%)}
#viewport[data-game="zzz"] .ticket.has-image .card-media{border:2px solid #151a17;background-color:#c5cc9b}
#viewport[data-game="zzz"] .ticket.image-background .card-image-shade{background:linear-gradient(90deg,#111610fa 0%,#161b14f0 34%,#1d211890 63%,#1d211808 100%)}
#viewport[data-game="zzz"] .ticket.image-background .ticket-top{color:#e6ee67}
#viewport[data-ready="error"] #render-error{position:absolute;inset:340px 220px auto;padding:30px;background:#341e1eee;color:#fff5ef;border:1px solid #c87f65;font-size:28px;line-height:1.5;z-index:99;white-space:pre-wrap}
`;

function runtimeScript(themeRuntime: string): string { return `
(function(){
  'use strict';
  var episode=JSON.parse(document.getElementById('episode-data').textContent);
  var settings=JSON.parse(document.getElementById('render-settings').textContent);
  var imageSources=JSON.parse(document.getElementById('image-sources').textContent);
  var hooks={};
  var embedded=window.parent!==window;
  var hostOrigin=location.origin==='null'?'*':location.origin;
  function notifyHost(message){if(embedded)window.parent.postMessage(message,hostOrigin);}
  var root=document.getElementById('viewport');
  var centerFocus=episode.presentation==='center-focus';
  var sceneEls=Array.from(document.querySelectorAll('.scene'));
  var chapterEls=Array.from(document.querySelectorAll('.chapter'));
  var caption=document.querySelector('.captions');
  var captionText=caption.querySelector('p');
  var progress=document.getElementById('global-progress');
  var transit=document.getElementById('transition');
  var panel=transit.querySelector('.transit-panel');
  var starsCanvas=document.getElementById('starfield');
  var ctx=starsCanvas.getContext('2d');
  var playing=false,time=0,anchor=0,raf=0,active=-1,lastCue=-2;
  var reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var clamp=function(v,a,b){return Math.max(a,Math.min(b,v));};
  var ease=function(v){v=clamp(v,0,1);return 1-Math.pow(1-v,3);};
  var smooth=function(v){v=clamp(v,0,1);return v*v*(3-2*v);};
  var stage={left:40,right:1880,top:244,bottom:936,cx:960,cy:590};
  ${STAR_RAIL_TRANSITION_RUNTIME}
  ${themeRuntime}
  var seed=93021;
  function random(){seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;}
  var stars=Array.from({length:210},function(){return {x:random()*1920,y:random()*1080,r:.55+random()*1.3,s:.3+random()*1.1,p:random()*Math.PI*2};});
  var cards=sceneEls.map(function(el){return Array.from(el.querySelectorAll('.ticket')).map(function(card){var canvas=card.querySelector('canvas');return {el:card,canvas:canvas,ctx:canvas.getContext('2d'),width:0,height:0};});});
  function fit(){var scale=Math.min(innerWidth/1920,innerHeight/1080);root.style.transform='translate(-50%,-50%) scale('+scale+')';}
  function arrangeScenes(){sceneEls.forEach(function(el,index){var scene=episode.scenes[index],heading=el.querySelector('.scene-heading'),title=heading.querySelector('h1'),group=el.querySelector('.cards');if(centerFocus){var fontSize=34;title.style.fontSize=fontSize+'px';while(heading.offsetTop+heading.offsetHeight>stage.top-12&&fontSize>20){fontSize--;title.style.fontSize=fontSize+'px';}group.style.top='0px';group.style.height='1080px';return;}var hero=(scene.kind==='intro'||scene.kind==='outro')&&scene.cards.length<=3;title.style.fontSize=(hero?88:(scene.title.indexOf('\\n')>=0?54:61))+'px';var top=Math.max(hero?616:386,heading.offsetTop+heading.offsetHeight+25);group.style.top=top+'px';group.style.height=Math.max(230,872-top)+'px';});}
  function sizeCards(changed){cards.forEach(function(group){group.forEach(function(card){
    if(changed&&!changed.has(card))return;
    card.width=card.el.offsetWidth;card.height=card.el.offsetHeight;card.canvas.width=card.width;card.canvas.height=card.height;
    var heading=card.el.querySelector('h2'),copy=card.el.querySelector('p');
    [heading,copy].forEach(function(el){if(!el.dataset.baseFont)el.dataset.baseFont=String(parseFloat(getComputedStyle(el).fontSize));el.style.fontSize=el.dataset.baseFont+'px';});
    var copySize=Number(copy.dataset.baseFont),headingSize=Number(heading.dataset.baseFont);
    var copyBox=card.el.querySelector('.ticket-copy');
    if(copyBox){
      var fits=function(){return copyBox.scrollHeight<=copyBox.clientHeight+1&&copyBox.scrollWidth<=copyBox.clientWidth+1;};
      while(!fits()&&copySize>18){copySize--;copy.style.fontSize=copySize+'px';}
      while(!fits()&&headingSize>24){headingSize--;heading.style.fontSize=headingSize+'px';}
      card.el.dataset.overflow=String(!fits());
      return;
    }
    while(copy.offsetTop+copy.offsetHeight>card.height-34&&copySize>20){copySize--;copy.style.fontSize=copySize+'px';}
    while(copy.offsetTop+copy.offsetHeight>card.height-34&&headingSize>26){headingSize--;heading.style.fontSize=headingSize+'px';}
    card.el.dataset.overflow=String(copy.offsetTop+copy.offsetHeight>card.height-27);
  });});}
  function drawStars(t,warp){ctx.clearRect(0,0,1920,1080);if(!settings.particles)return;if(hooks.stars){hooks.stars(t,warp);return;}ctx.globalAlpha=Math.min(1,settings.particles);stars.slice(0,Math.ceil(105*settings.particles)).forEach(function(s){var x=(s.x+t*(3+s.s*2))%1920;var y=s.y+Math.sin(t*.12+s.p)*9;var alpha=.18+.28*(1+Math.sin(t*s.s+s.p))/2;ctx.fillStyle='rgba(185,224,248,'+alpha+')';ctx.beginPath();ctx.arc(x,y,s.r,0,Math.PI*2);ctx.fill();if(warp>0){ctx.strokeStyle='rgba(135,220,248,'+(warp*.24)+')';ctx.lineWidth=s.r;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x-160*warp*s.s,y);ctx.stroke();}});
    for(var i=0;i<3;i++){var baseY=520+i*95;ctx.strokeStyle='rgba(98,171,201,.065)';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(0,baseY+130);ctx.bezierCurveTo(500,baseY+180,1320,baseY-170,1920,baseY-120);ctx.stroke();}
  }
  function drawCard(card,t,index,highlight){var c=card.ctx,w=card.width,h=card.height;c.clearRect(0,0,w,h);if(!w||!h||!settings.particles)return;if(hooks.card){hooks.card(card,t,index,highlight);return;}c.globalAlpha=Math.min(1,settings.particles);var phase=(t*.075+index*.31)%1;var x=34+(w-68)*phase;var y=h-17;c.fillStyle=index===0?'rgba(40,73,91,.7)':'rgba(153,232,255,.9)';c.shadowBlur=12;c.shadowColor='#8ddafa';c.beginPath();c.arc(x,y,2.3,0,Math.PI*2);c.fill();c.shadowBlur=0;
    for(var j=0;j<Math.ceil(7*settings.particles);j++){var p=(t*(.038+j*.002)+j*.139+index*.073)%1;var px=15+(w-30)*p;var py=12+(j%2)*(h-24)+Math.sin(t*.9+j)*3;var a=.15+Math.pow(Math.max(0,Math.sin(t*1.3+j)),3)*.5;c.fillStyle=index===0?'rgba(45,73,80,'+a+')':'rgba(142,214,239,'+a+')';c.fillRect(px,py,j%3===0?4:2,1.5);}
    var pulse=(Math.sin(t*1.8+index)+1)/2;if(highlight){c.strokeStyle=index===0?'rgba(90,74,34,'+(.14+pulse*.18)+')':'rgba(137,221,250,'+(.2+pulse*.22)+')';c.lineWidth=1.5;c.strokeRect(7,7,w-14,h-14);c.beginPath();c.arc(w-25,h-25,5+pulse*8,0,Math.PI*2);c.stroke();}
  }
  function focusPose(cardIndex,activeIndex,count){
    if(cardIndex===activeIndex)return {x:0,y:0,scale:1,opacity:1,rotate:0};
    var offset=(cardIndex-activeIndex+count)%count;
    var side=offset<=count/2?1:-1;
    var depth=Math.min(offset,count-offset)-1;
    return {x:side*(880+depth*110),y:34+depth*35,scale:.34-depth*.025,opacity:.24-depth*.04,rotate:side*4};
  }
  function renderFocusCards(index,local){
    var scene=episode.scenes[index],sequence=scene.focusCues,current=0;
    for(var k=1;k<sequence.length;k++){if(local>=sequence[k].start)current=k;else break;}
    var target=sequence[current].cardIndex,previous=current?sequence[current-1].cardIndex:target;
    var style=motionStyle(scene,index,current);
    var cueEnd=current+1<sequence.length?sequence[current+1].start:scene.duration;
    var cueMotion=Math.min(motionDuration(style),Math.max(.001,(cueEnd-sequence[current].start)*.8));
    var phase=current?clamp((local-sequence[current].start)/cueMotion,0,1):1;
    if(reduced)phase=1;
    var entry=reduced?1:ease((local+.2)/Math.min(.75,scene.duration*.3));
    cards[index].forEach(function(card,j){
      var from=focusPose(j,previous,scene.cards.length),to=focusPose(j,target,scene.cards.length);
      var pose=focusMotion(from,to,style,phase,j===target,j===previous&&previous!==target);
      if(hooks.motion)pose=hooks.motion(pose,from,to,style,phase,j===target,j===previous&&previous!==target);
      var emphasis=clamp((pose.scale-.34)/.66,0,1);
      card.el.style.transform='translate3d('+pose.x+'px,'+(pose.y+(1-entry)*32)+'px,0) scale('+(pose.scale*(.97+.03*entry))+') rotate('+pose.rotate+'deg) rotateY('+pose.turn+'deg)';
      card.el.style.opacity=String(pose.opacity*entry);
      card.el.style.filter='brightness('+(.66+.34*emphasis)+') saturate('+(.6+.4*emphasis)+') blur('+pose.blur+'px)';
      card.el.style.clipPath=pose.reveal<.999?'inset(0 '+((1-pose.reveal)*50)+'%)':'';
      card.el.style.zIndex=String(2+Math.round(emphasis*16));
      card.el.dataset.focused=String(j===target);
      card.el.style.boxShadow='inset 0 0 0 '+(1+emphasis)+'px '+(settings.game==='starrail'?(j===0?'#e2c58899':'#a8e3f077'):'var(--theme-edge)');
      drawCard(card,reduced?0:local,j,j===target);
    });
    sceneEls[index].dataset.focusCard=String(target);
    sceneEls[index].dataset.transitionStyle=style;
    sceneEls[index].dataset.transitionPhase=String(phase);
    drawTransition(style,phase,.8);
  }
  function renderScene(index,local,visibility,shift){var el=sceneEls[index];var scene=episode.scenes[index];el.style.visibility='visible';el.style.opacity=String(visibility);el.style.transform='translateX('+shift+'px)';var entering=(reduced||index===0)?1:ease((local+.08)/.7);var heading=el.querySelector('.scene-heading');heading.style.opacity=String(entering);heading.style.transform='translateX('+((1-entering)*32)+'px)';
    if(centerFocus){renderFocusCards(index,local);}else{
    var highlight=Math.min(scene.cards.length-1,Math.floor(Math.max(0,local-2.6)/Math.max(4.5,(scene.duration-4)/Math.max(1,scene.cards.length))));
    cards[index].forEach(function(card,j){var entry=index===0?ease((local+.95-j*.13)/.75):ease((local-.15-j*.14)/.8);if(reduced)entry=1;card.el.style.opacity=String(entry);card.el.style.transform='translateX('+((1-entry)*(j%2?72:-72))+'px) scale('+Math.min(1,settings.cardScale/1.2)+')';var on=j===highlight;card.el.style.boxShadow=on?'inset 0 0 0 1px '+(settings.game==='starrail'?(j===0?'#dcbf82':'#9edbef77'):'var(--theme-edge)'):'none';drawCard(card,reduced?0:local,j,on);});
    }
    var emblem=el.querySelector('.scene-emblem');if(emblem){emblem.querySelector('.orbit-one').style.transform='rotate('+(-25+(reduced?0:Math.sin(local*.1)*8))+'deg)';emblem.querySelector('.orbit-two').style.transform='rotate('+(50+(reduced?0:Math.sin(local*.08)*9))+'deg)';}
  }
  function sceneCardTransition(index,style,p,incoming){
    var group=sceneEls[index].querySelector('.cards'),m=smooth(p),q=incoming?m:1-m;
    group.style.transformOrigin=stage.cx+'px '+stage.cy+'px';group.style.transform='';group.style.clipPath='';
    if(style==='ticket')group.style.transform='scaleX('+(incoming ? .18+.82*m : 1-.82*m)+')';
    if(style==='orbit')group.style.transform='translateX('+((incoming?1:-1)*(1-q)*100)+'px) scale(' +(.94+.06*q)+')';
    if(style==='hologram')group.style.clipPath='inset('+stage.top+'px '+((1-q)*50)+'% '+(1080-stage.bottom)+'px)';
  }
  function fitCaption(){
    var fontSize=settings.captionSize;captionText.style.fontSize=fontSize+'px';
    while(captionText.scrollWidth>captionText.clientWidth+1&&fontSize>18){fontSize--;captionText.style.fontSize=fontSize+'px';}
  }
  function render(seconds){time=clamp(Number(seconds)||0,0,episode.duration);var index=0;for(var i=0;i<episode.scenes.length;i++){if(time>=episode.scenes[i].start)index=i;else break;}var scene=episode.scenes[index];var local=time-scene.start;var style=scene.transition||'ticket-wipe';var classicScene=!centerFocus||style==='ticket-wipe'||style==='classic';var mix=index>0?clamp(local/(Math.min(classicScene ? 1.1 : .9,scene.duration*.45)),0,1):1;var inTransition=index>0&&mix<1&&!reduced;var incoming=smooth(mix);
    fx.clearRect(0,0,1920,1080);
    if(centerFocus)sceneEls.forEach(function(el){var group=el.querySelector('.cards');group.style.transform='';group.style.clipPath='';});
    if(active!==index){sceneEls.forEach(function(el){el.style.visibility='hidden';el.style.opacity='0';});active=index;root.dataset.scene=scene.id;}
    if(inTransition){
      var distance=classicScene?80:(style==='warp'?150:0);
      renderScene(index-1,time-episode.scenes[index-1].start,1-incoming,-distance*incoming);renderScene(index,local,incoming,distance*(1-incoming));
      if(centerFocus){sceneCardTransition(index-1,style,mix,false);sceneCardTransition(index,style,mix,true);}
      if(centerFocus||hooks.transition)drawTransition(style,mix,1,true);
    }else{if(index>0){sceneEls[index-1].style.visibility='hidden';sceneEls[index-1].style.opacity='0';}renderScene(index,Math.max(0,local),1,0);}
    var warp=inTransition?Math.sin(mix*Math.PI):0;transit.style.opacity=String(classicScene&&settings.game==='starrail'?warp*.9:0);panel.style.transform='translateX('+(-230+2600*smooth(mix))+'px) skewX(-17deg)';drawStars(reduced?0:time,(classicScene||style==='warp')?warp:0);
    chapterEls.forEach(function(el,j){var start=Number(el.dataset.start),end=Number(el.dataset.end);el.classList.toggle('active',time>=start&&time<end);el.classList.toggle('passed',time>=end);el.querySelector('.chapter-progress').style.transform='scaleX('+clamp((time-start)/(end-start),0,1)+')';});
    var cue=-1;for(var k=0;k<episode.cues.length;k++){if(time>=episode.cues[k].start&&time<episode.cues[k].end){cue=k;break;}}
    if(cue!==lastCue){captionText.textContent=cue<0?'':episode.cues[cue].text;caption.style.opacity=cue<0?'0':'1';fitCaption();lastCue=cue;}progress.style.transform='scaleX('+(time/episode.duration)+')';root.dataset.time=time.toFixed(3);
  }
  function tick(now){if(!playing)return;render((now-anchor)/1000);if(time>=episode.duration){pause();return;}raf=requestAnimationFrame(tick);}
  function play(){if(embedded){notifyHost({type:'moyo:toggle'});return;}if(playing)return;if(time>=episode.duration)render(0);playing=true;anchor=performance.now()-time*1000;raf=requestAnimationFrame(tick);root.dataset.playing='true';}
  function pause(){playing=false;cancelAnimationFrame(raf);root.dataset.playing='false';}
  function seek(seconds){render(seconds);if(playing)anchor=performance.now()-time*1000;}
  function jump(seconds){seconds=clamp(seconds,0,episode.duration);if(embedded)notifyHost({type:'moyo:jump',time:seconds});else seek(seconds);}
  function toggle(){if(embedded)notifyHost({type:'moyo:toggle'});else if(playing)pause();else play();}
  function resizeCards(sizes){
    if(!Array.isArray(sizes)||!sizes.every(function(size){return size&&typeof size.sceneId==='string'&&typeof size.cardId==='string'&&Number.isInteger(size.width)&&Number.isInteger(size.height)&&size.width>=settings.sizeLimits.width.min&&size.width<=settings.sizeLimits.width.max&&size.height>=settings.sizeLimits.height.min&&size.height<=settings.sizeLimits.height.max;}))return;
    var changed=new Set();
    sizes.forEach(function(size){
      var sceneIndex=episode.scenes.findIndex(function(scene){return scene.id===size.sceneId;});
      if(sceneIndex<0)return;
      var cardIndex=episode.scenes[sceneIndex].cards.findIndex(function(card){return card.id===size.cardId;});
      if(cardIndex<0)return;
      var card=cards[sceneIndex][cardIndex];
      episode.scenes[sceneIndex].cards[cardIndex].size={width:size.width,height:size.height};
      if(card.el.style.getPropertyValue('--card-width')===size.width+'px'&&card.el.style.getPropertyValue('--card-height')===size.height+'px')return;
      card.el.style.setProperty('--card-width',size.width+'px');card.el.style.setProperty('--card-height',size.height+'px');changed.add(card);
    });
    if(changed.size){sizeCards(changed);render(time);}
  }
  root.addEventListener('click',function(event){var chapter=event.target.closest('.chapter');if(chapter){jump(Number(chapter.dataset.start));return;}toggle();});
  window.addEventListener('keydown',function(event){if(event.code==='Space'){event.preventDefault();toggle();}else if(event.code==='ArrowRight'){event.preventDefault();jump(time+5);}else if(event.code==='ArrowLeft'){event.preventDefault();jump(time-5);}});
  window.addEventListener('message',function(event){
    if(!embedded||event.source!==window.parent||(hostOrigin!=='*'&&event.origin!==hostOrigin))return;
    var message=event.data;
    if(message&&message.type==='moyo:card-sizes'){resizeCards(message.sizes);return;}
    if(!message||message.type!=='moyo:seek'||typeof message.time!=='number'||!Number.isFinite(message.time))return;
    pause();seek(message.time);
  });
  window.addEventListener('resize',fit);fit();arrangeScenes();sizeCards();
  window.__weekly={seek:seek,play:play,pause:pause,duration:episode.duration};
  var imageElements=Array.from(document.querySelectorAll('img.card-image'));
  root.dataset.imageCount=String(imageElements.length);
  function decodeImage(img){return Promise.resolve().then(function(){
    var source=imageSources[img.dataset.assetId];
    if(typeof source!=='string'||['data:image/png;base64','data:image/jpeg;base64','data:image/webp;base64'].indexOf(source.split(',')[0])<0)throw new Error('配图来源无效');
    img.src=source;return img.decode();
  }).then(function(){
    if(!img.complete||img.naturalWidth<=0||img.naturalHeight<=0)throw new Error('配图尺寸无效：'+img.dataset.assetId);
    img.dataset.imageState='decoded';
  }).catch(function(){img.dataset.imageState='failed';throw new Error('配图解码失败：'+img.dataset.assetId);});}
  render(0);Promise.all([document.fonts.ready].concat(imageElements.map(decodeImage))).then(function(){
    arrangeScenes();sizeCards();lastCue=-2;render(time);root.dataset.ready='true';notifyHost({type:'moyo:ready',duration:episode.duration});
  }).catch(function(error){
    pause();root.dataset.ready='error';root.dataset.error=String(error.message||error);
    var box=document.createElement('div');box.id='render-error';box.setAttribute('role','alert');box.textContent=root.dataset.error;root.appendChild(box);
    notifyHost({type:'moyo:error',error:root.dataset.error});
  });
})();
`; }

/**
 * HTML is offline-ready and starts paused. Recording example:
 *   await page.evaluate(t => window.__weekly.seek(t), seconds)
 * Wait for document.fonts.ready before taking the first frame.
 */
export function createWeeklyEpisodeHtml(episode: Episode, options: EpisodeOptions = {}): string {
  if (!episode.scenes.length || !Number.isFinite(episode.duration) || episode.duration <= 0) {
    throw new Error('An episode needs a positive duration and at least one scene.');
  }
  episode.scenes.forEach((scene, index) => {
    if (!Number.isFinite(scene.start) || !Number.isFinite(scene.duration) || scene.duration <= 0 || scene.start < 0) {
      throw new Error(`Invalid timing for scene ${scene.id}.`);
    }
    if (index && scene.start <= episode.scenes[index - 1].start) throw new Error('Scenes must be ordered by start time.');
    if (scene.cards.length < 1 || scene.cards.length > 6) throw new Error(`Scene ${scene.id} needs one to six cards.`);
    for (const card of scene.cards) {
      if (card.size && (!Number.isInteger(card.size.width) || !Number.isInteger(card.size.height)
        || card.size.width < CARD_SIZE_LIMITS.width.min || card.size.width > CARD_SIZE_LIMITS.width.max
        || card.size.height < CARD_SIZE_LIMITS.height.min || card.size.height > CARD_SIZE_LIMITS.height.max)) {
        throw new Error(`卡片尺寸无效：${scene.id} / ${card.id ?? card.title}`);
      }
    }
    if (scene.start + scene.duration > episode.duration + 0.001) throw new Error(`Scene ${scene.id} exceeds the episode duration.`);
    if (episode.presentation === 'center-focus') {
      if (!scene.focusCues?.length || scene.focusCues[0].start !== 0) throw new Error(`Scene ${scene.id} needs a focus cue at zero.`);
      scene.focusCues.forEach((cue, cueIndex) => {
        if (!Number.isFinite(cue.start) || cue.start < 0 || cue.start >= scene.duration || !Number.isInteger(cue.cardIndex) || cue.cardIndex < 0 || cue.cardIndex >= scene.cards.length) throw new Error(`Invalid focus cue in ${scene.id}.`);
        if (cueIndex && cue.start <= scene.focusCues![cueIndex - 1].start) throw new Error(`Focus cues must be ordered in ${scene.id}.`);
      });
    }
  });
  const theme = options.theme ?? {
    id: 'starrail', brand: '星穹列车 · 每周公报', tagline: '版本动态 · 活动见闻 · 开拓者社区',
    emblem: '星穹列车', curtainLabel: '星穹列车 · 下一站', css: '', runtime: '',
  };
  const bounded = (value: number | undefined, fallback: number, min: number, max: number) =>
    Number.isFinite(value) ? Math.min(max, Math.max(min, value!)) : fallback;
  const settings = {
    game: theme.id, particles: bounded(options.particles, 1, 0, 2),
    cardScale: bounded(options.cardScale, 1.2, 0.7, 1.2), captionSize: bounded(options.captionSize, 28, 18, 48),
    sizeLimits: CARD_SIZE_LIMITS,
  };
  // Each asset is embedded once, even when many cards reuse it.
  const resolvedImages: Record<string, string> = Object.create(null);
  for (const scene of episode.scenes) for (const card of scene.cards) {
    if (card.image) resolvedImages[card.image.assetId] = imageSource(card.image, options.imageSources ?? {}, resolvedImages[card.image.assetId]);
  }
  const chapters: Array<{ label: string; start: number; end: number }> = [];
  episode.scenes.forEach(scene => {
    const label = theme.id !== 'starrail' ? scene.section : /国内|海外|线下/.test(scene.section) ? '线下行程'
      : /版本|角色|活动进行|新玩法|福利/.test(scene.section) ? '版本与活动'
        : /社区|热点/.test(scene.section) ? '社区与热点'
          : scene.section;
    const previous = chapters[chapters.length - 1];
    if (previous?.label === label) previous.end = scene.start + scene.duration;
    else chapters.push({ label, start: scene.start, end: scene.start + scene.duration });
  });
  const scriptJson = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  if (options.fontDataUri && !/^data:(?:font\/[a-z0-9.+-]+|application\/(?:x-font-ttf|font-woff|octet-stream));base64,[a-z0-9+/=]+$/i.test(options.fontDataUri)) {
    throw new Error('fontDataUri must be a base64 font data URI.');
  }
  const font = options.fontDataUri ? `@font-face{font-family:EpisodeFont;src:url("${options.fontDataUri}");font-display:block;}` : '';
  const captionHeight = Math.max(54, Math.ceil(settings.captionSize * 1.2 + 12));
  const adaptiveCss = `.chapters{gap:${Math.max(3, 25 - chapters.length)}px}.chapter,.center-focus .chapter{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:${Math.max(10, Math.min(16, 110 / Math.max(1, chapters.length)))}px;letter-spacing:${chapters.length > 9 ? 0 : 1}px}.chapter:before{margin-right:${chapters.length > 9 ? 4 : 13}px}.captions,.center-focus .captions{height:${captionHeight}px;display:flex;align-items:center;justify-content:center}.captions p,.center-focus .captions p{font-size:${settings.captionSize}px;line-height:1.2;margin:0}.center-focus .scene .ticket{transform-origin:center}.scene-heading{overflow-wrap:anywhere}.period{max-width:560px;overflow-wrap:anywhere}.source p{min-width:0}#viewport:not([data-game="starrail"]) .captions p{color:inherit;text-shadow:none}`;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(episode.title)}</title><style>${font}${CSS}${adaptiveCss}${theme.css}${IMAGE_CSS}</style></head><body>
    <main id="viewport" class="${episode.presentation === 'center-focus' ? 'center-focus' : ''}" data-game="${theme.id}" data-playing="false" aria-label="${escapeHtml(episode.title)}">
      <div class="background"></div><canvas id="starfield" width="1920" height="1080" aria-hidden="true"></canvas>
      <div class="brand"><i class="brand-mark" aria-hidden="true"></i><div><b>${escapeHtml(theme.brand)}</b><small>${escapeHtml(theme.tagline)}</small></div></div>
      <div class="period">${escapeHtml(episode.period)}<small>米游资讯周报 · 同人制作</small></div>
      <nav class="chapters" aria-label="视频章节">${chapters.map(chapter => `<button class="chapter" title="${escapeHtml(chapter.label)}" data-start="${chapter.start}" data-end="${chapter.end}">${escapeHtml(chapter.label)}<span class="chapter-progress"></span></button>`).join('')}</nav>
      ${episode.scenes.map((scene, index) => sceneMarkup(scene, index, theme.emblem, { starrail: '下一站', genshin: '旅行记', hi3: '档案', zzz: 'PLAY' }[theme.id], settings.cardScale)).join('')}
      <div id="transition" aria-hidden="true"><div class="transit-flash"></div><div class="transit-panel" data-label="${escapeHtml(theme.curtainLabel)}"></div></div>
      <canvas id="focus-transition" width="1920" height="1080" aria-hidden="true"></canvas>
      <div class="captions" aria-live="off"><p></p></div><div id="global-progress"></div>
    </main><script id="episode-data" type="application/json">${scriptJson(episode)}</script><script id="render-settings" type="application/json">${scriptJson(settings)}</script><script id="image-sources" type="application/json">${scriptJson(resolvedImages)}</script><script>${runtimeScript(theme.runtime)}</script></body></html>`;
}
