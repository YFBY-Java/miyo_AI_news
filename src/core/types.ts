export type Game = 'starrail' | 'genshin' | 'hi3' | 'zzz';
export type Transition = 'classic' | 'warp' | 'orbit' | 'ticket' | 'hologram' | 'ticket-wipe';
export type VoicePreset = 'kiana-base' | 'xiaoxiao';
export interface Source { id: string; title: string; url: string; publisher: string; date: string; note: string; text?: string; status: 'unverified' | 'verified' | 'community' }
export interface CardImage { assetId: string; layout: 'left' | 'right' | 'background'; fit: 'cover' | 'contain'; positionX: number; positionY: number }
export interface ImageAsset { id: string; name: string; mime: 'image/png' | 'image/jpeg' | 'image/webp'; width: number; height: number; size: number; createdAt: string; url: string }
export interface CardSize { width: number; height: number }
export interface Card { id: string; label: string; title: string; body: string; image?: CardImage; size?: CardSize }
export interface Focus { at: number; cardId: string; transition: Transition }
export interface Scene { id: string; section: string; kind: 'intro' | 'news' | 'event' | 'community' | 'outro'; title: string; subtitle: string; kicker: string; metric: string; cards: Card[]; narration: string; sourceIds: string[]; transition: Transition; focus: Focus[] }
export interface Project {
  schemaVersion: 1; id: string; revision: number; title: string; game: Game; period: string; cutoff: string; createdAt: string; updatedAt: string;
  sources: Source[]; scenes: Scene[]; voice: { preset: VoicePreset; speed: number };
  presentation: { particles: number; cardScale: number; captionSize: number };
  origin?: string;
}
export type JobKind = 'prepare' | 'render' | 'sample';
export interface Job {
  id: string; projectId: string; revision: number; kind: JobKind; sceneId?: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'; stage: string; progress: number; message: string;
  createdAt: string; updatedAt: string; error?: string;
  outputs?: { video?: string; audio?: string; preview?: string; subtitles?: string; timeline?: string; report?: string };
}
export interface PreviewInfo { url: string; audioUrl?: string; duration: number; ready: boolean; stale: boolean; sceneTimes: { id: string; start: number; duration: number }[] }
export interface ProjectResponse { project: Project; jobs: Job[]; preview: PreviewInfo }
export interface Capability { id: string; label: string; available: boolean; detail: string }
export interface VoiceScene { id: string; duration: number; cues: { start: number; end: number; text: string }[] }
export interface VoicePlan { duration: number; scenes: VoiceScene[]; preset: VoicePreset; speed: number; audioFile: string }
export const GAMES: { id: Game; name: string; description: string; color: string }[] = [
  { id: 'starrail', name: '崩坏：星穹铁道', description: '星穹列车 · 宇宙公报', color: '#cdb27d' },
  { id: 'genshin', name: '原神', description: '提瓦特 · 旅行手记', color: '#7dac96' },
  { id: 'hi3', name: '崩坏3', description: '女武神档案 · 星海歌剧', color: '#bd9cd9' },
  { id: 'zzz', name: '绝区零', description: '新艾利都 · 录像店频道', color: '#d9e86d' },
];
export const TRANSITIONS: { id: Transition; name: string }[] = [
  { id: 'classic', name: '平滑交接' }, { id: 'warp', name: '掠光切入' }, { id: 'orbit', name: '弧线交会' },
  { id: 'ticket', name: '折页切换' }, { id: 'hologram', name: '扫描显影' }, { id: 'ticket-wipe', name: '章节幕切' },
];
