import { createHash, randomUUID } from 'node:crypto';
import type { Episode } from '../engine/legacy/weekly-episode';
import { GAMES, TRANSITIONS, type CardImage, type CardSize, type Game, type Project, type Scene, type VoicePlan } from './types';
import { CARD_SIZE_LIMITS } from './card-layout';

export class InputError extends Error { constructor(message: string, public status = 400) { super(message); } }
export const uid = () => randomUUID();
export function safeId(value: unknown): string {
  if (typeof value !== 'string' || !/^[\w-]{1,80}$/.test(value)) throw new InputError('无效的项目或素材编号');
  return value;
}
function str(value: unknown, label: string, max: number, required = false): string {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw new InputError(`${label}${required ? '不能为空，且' : ''}最多 ${max} 字`);
  return value;
}
function number(value: unknown, min: number, max: number, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new InputError(`${label}需要在 ${min}–${max} 之间`);
  return value;
}
function unique(ids: string[], label: string) { if (new Set(ids).size !== ids.length) throw new InputError(`${label}编号重复`); }
function validateCardSize(value: unknown): CardSize {
  const size = value as CardSize;
  if (!size || typeof size !== 'object') throw new InputError('卡片尺寸设置无效');
  const width = number(size.width, CARD_SIZE_LIMITS.width.min, CARD_SIZE_LIMITS.width.max, '卡片宽度');
  const height = number(size.height, CARD_SIZE_LIMITS.height.min, CARD_SIZE_LIMITS.height.max, '卡片高度');
  if (!Number.isInteger(width) || !Number.isInteger(height)) throw new InputError('卡片尺寸需要为整数像素');
  return { width, height };
}
function validateCardImage(value: unknown): CardImage {
  const image = value as CardImage;
  if (!image || typeof image !== 'object') throw new InputError('卡片配图设置无效');
  if (!['left', 'right', 'background'].includes(image.layout)) throw new InputError('请选择有效的配图布局');
  if (!['cover', 'contain'].includes(image.fit)) throw new InputError('请选择有效的图片显示方式');
  return { assetId: safeId(image.assetId), layout: image.layout, fit: image.fit,
    positionX: number(image.positionX, 0, 100, '图片水平位置'), positionY: number(image.positionY, 0, 100, '图片垂直位置') };
}
export function validateProject(input: unknown): Project {
  const p = input as Project;
  if (!p || typeof p !== 'object' || p.schemaVersion !== 1) throw new InputError('无法读取此项目格式');
  safeId(p.id);
  if (!GAMES.some(g => g.id === p.game)) throw new InputError('请选择四种游戏风格之一');
  if (!Array.isArray(p.scenes) || p.scenes.length < 1 || p.scenes.length > 40) throw new InputError('每期需要 1–40 个分镜');
  if (!Array.isArray(p.sources) || p.sources.length > 100) throw new InputError('资料数量不能超过 100 条');
  if (!p.voice || !['kiana-base', 'xiaoxiao'].includes(p.voice.preset)) throw new InputError('请选择可用声线');
  number(p.voice.speed, .5, 2, '语速');
  if (!p.presentation) throw new InputError('缺少画面设置');
  number(p.presentation.particles, 0, 2, '粒子强度'); number(p.presentation.cardScale, .7, 1.2, '卡片比例'); number(p.presentation.captionSize, 18, 48, '字幕字号');
  unique(p.sources.map(s => safeId(s.id)), '资料');
  unique(p.scenes.map(s => safeId(s.id)), '分镜');
  const sources = p.sources.map(s => {
    const url = str(s.url, '链接', 2500);
    if (url) { try { if (!['http:', 'https:'].includes(new URL(url).protocol)) throw 0; } catch { throw new InputError('来源链接需要为 http 或 https'); } }
    if (!['verified', 'unverified', 'community'].includes(s.status)) throw new InputError('资料核对状态无效');
    return { id: s.id, title: str(s.title, '资料标题', 250, true), url, publisher: str(s.publisher, '发布方', 200), date: str(s.date, '日期', 100), note: str(s.note, '来源说明', 3000), text: str(s.text ?? '', '资料原文', 60000), status: s.status };
  });
  const sourceIds = new Set(sources.map(s => s.id));
  const scenes = p.scenes.map(s => {
    if (!['intro', 'news', 'event', 'community', 'outro'].includes(s.kind)) throw new InputError('分镜类型无效');
    if (!Array.isArray(s.cards) || s.cards.length < 1 || s.cards.length > 6) throw new InputError('每个分镜需要 1–6 张卡片');
    unique(s.cards.map(c => safeId(c.id)), '卡片');
    if (!TRANSITIONS.some(t => t.id === s.transition)) throw new InputError('转场类型无效');
    if (!Array.isArray(s.sourceIds) || s.sourceIds.some(id => !sourceIds.has(id))) throw new InputError('分镜引用了不存在的来源');
    if (!Array.isArray(s.focus) || !s.focus.length || s.focus.length > 60 || s.focus[0].at !== 0) throw new InputError('卡片时间轴必须从 0% 开始');
    s.focus.forEach((f, i) => {
      number(f.at, 0, .98, '卡片切换位置');
      if (i && f.at <= s.focus[i - 1].at) throw new InputError('卡片切换位置必须按时间递增');
      if (!s.cards.some(c => c.id === f.cardId)) throw new InputError('卡片时间轴引用了已删除的卡片');
      if (!TRANSITIONS.some(t => t.id === f.transition)) throw new InputError('卡片切换动画无效');
    });
    return { id: s.id, section: str(s.section, '章节名称', 80, true), kind: s.kind, title: str(s.title, '分镜标题', 100, true), subtitle: str(s.subtitle ?? '', '副标题', 200), kicker: str(s.kicker ?? '', '眉题', 120), metric: str(s.metric ?? '', '角标', 60), cards: s.cards.map(c => ({id:c.id, label:str(c.label, '卡片标签', 60), title:str(c.title, '卡片标题', 100,true),body:str(c.body, '卡片正文', 1000,true),...(c.image !== undefined ? {image:validateCardImage(c.image)} : {}),...(c.size !== undefined ? {size:validateCardSize(c.size)} : {})})), narration: str(s.narration, '口播', 8000, true), sourceIds:s.sourceIds, transition:s.transition, focus:s.focus.map(f => ({at:f.at,cardId:f.cardId,transition:f.transition})) };
  });
  return {schemaVersion:1, id:p.id, revision:Number.isInteger(p.revision) ? p.revision : 0, title:str(p.title,'项目标题',160,true), game:p.game, period:str(p.period,'报道日期',100), cutoff:str(p.cutoff,'资料截止时间',160), createdAt:str(p.createdAt,'创建时间',80),updatedAt:str(p.updatedAt,'更新时间',80),sources,scenes,voice:{...p.voice},presentation:{...p.presentation},...(p.origin ? {origin:str(p.origin,'来源',200)} : {})};
}
function hash(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
export function audioKey(p: Project): string { return hash({version:1, voice:p.voice, scenes:p.scenes.map(s => ({id:s.id,narration:s.narration}))}); }
export function projectKey(p: Project): string { const {id,revision,createdAt,updatedAt,origin,...content}=p; return hash(content); }
export function newScene(title='新的资讯', text='在这里写下这一段的口播内容。'): Scene {
  const cardId=uid();
  return {id:uid(),section:'资讯动态',kind:'news',title,subtitle:'',kicker:'资讯观察',metric:'',cards:[{id:cardId,label:'资讯',title,body:text}],narration:text,sourceIds:[],transition:'ticket-wipe',focus:[{at:0,cardId,transition:'classic'}]};
}
export function blankProject(title='新一期米游资讯', game:Game='starrail'): Project {
  const now=new Date().toISOString();
  return {schemaVersion:1,id:uid(),revision:1,title,game,period:new Date().toLocaleDateString('sv-SE'),cutoff:'资料待核对',createdAt:now,updatedAt:now,sources:[],scenes:[newScene()],voice:{preset:'kiana-base',speed:1.1},presentation:{particles:1,cardScale:1.2,captionSize:28}};
}
export function estimatePlan(p: Project): VoicePlan {
  const scenes=p.scenes.map(s=>{const duration=Math.max(5,s.narration.length/4.7/p.voice.speed+1);return {id:s.id,duration,cues:[{start:.3,end:duration-.3,text:s.narration.slice(0,40)}]};});
  return {duration:scenes.reduce((a,s)=>a+s.duration,0),scenes,preset:p.voice.preset,speed:p.voice.speed,audioFile:''};
}
export function compileEpisode(p: Project, plan: VoicePlan): Episode {
  if (plan.scenes.length !== p.scenes.length) throw new InputError('配音分镜数量不一致，请重新合成');
  let cursor=0;
  const cues: Episode['cues']=[];
  const scenes=p.scenes.map((s,i)=>{
    const voice=plan.scenes[i];
    if (voice.id!==s.id || !Number.isFinite(voice.duration) || voice.duration<=0) throw new InputError('配音时间轴与当前分镜不匹配');
    const start=cursor; cursor+=voice.duration;
    for(const c of voice.cues){
      if(!Number.isFinite(c.start)||!Number.isFinite(c.end)||c.start<0||c.end>voice.duration+.04||c.end<=c.start)throw new InputError('字幕时码超出配音范围');
      cues.push({start:start+c.start,end:start+Math.min(c.end,voice.duration),text:c.text});
    }
    return {id:s.id,start,duration:voice.duration,section:s.section,kind:s.kind,title:s.title,subtitle:s.subtitle,kicker:s.kicker,metric:s.metric,cards:s.cards.map(c=>({...c})),source:p.sources.filter(v=>s.sourceIds.includes(v.id)).map(v=>v.title).join(' · ')||'资料来源待核对',sourceIds:s.sourceIds,transition:s.transition,focusCues:s.focus.map(f=>({start:f.at*voice.duration,cardIndex:s.cards.findIndex(c=>c.id===f.cardId),transition:f.transition==='ticket-wipe'?'classic' as const:f.transition}))};
  });
  return {title:p.title,period:p.period,cutoff:p.cutoff,duration:cursor,presentation:'center-focus',scenes,cues};
}
export function toSrt(episode: Episode): string {
  const stamp=(v:number)=>{const ms=Math.round(v*1000);return `${String(Math.floor(ms/3600000)).padStart(2,'0')}:${String(Math.floor(ms/60000)%60).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')},${String(ms%1000).padStart(3,'0')}`;};
  return episode.cues.map((c,i)=>`${i+1}\n${stamp(c.start)} --> ${stamp(c.end)}\n${c.text}`).join('\n\n')+'\n';
}
