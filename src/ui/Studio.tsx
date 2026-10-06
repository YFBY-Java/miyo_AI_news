'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Add from '@mui/icons-material/Add';
import SaveOutlined from '@mui/icons-material/SaveOutlined';
import ContentCopyOutlined from '@mui/icons-material/ContentCopyOutlined';
import PlayArrowRounded from '@mui/icons-material/PlayArrowRounded';
import PauseRounded from '@mui/icons-material/PauseRounded';
import SkipPreviousRounded from '@mui/icons-material/SkipPreviousRounded';
import SkipNextRounded from '@mui/icons-material/SkipNextRounded';
import TuneRounded from '@mui/icons-material/TuneRounded';
import MovieCreationOutlined from '@mui/icons-material/MovieCreationOutlined';
import ArticleOutlined from '@mui/icons-material/ArticleOutlined';
import GraphicEqRounded from '@mui/icons-material/GraphicEqRounded';
import FileDownloadOutlined from '@mui/icons-material/FileDownloadOutlined';
import ArrowUpwardRounded from '@mui/icons-material/ArrowUpwardRounded';
import ArrowDownwardRounded from '@mui/icons-material/ArrowDownwardRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import CloseRounded from '@mui/icons-material/CloseRounded';
import CheckRounded from '@mui/icons-material/CheckRounded';
import RefreshRounded from '@mui/icons-material/RefreshRounded';
import FullscreenRounded from '@mui/icons-material/FullscreenRounded';
import LinkRounded from '@mui/icons-material/LinkRounded';
import HeadphonesRounded from '@mui/icons-material/HeadphonesRounded';
import ImageOutlined from '@mui/icons-material/ImageOutlined';
import type { Project, ProjectResponse, PreviewInfo, Job, JobKind, Game, Scene, Card, Source, Capability, Transition } from '../core/types';
import { GAMES, TRANSITIONS } from '../core/types';
import CardImageEditor, { type CardImageTarget } from './CardImageEditor';
import CardSizeEditor from './CardSizeEditor';
import { getCardSize } from '../core/card-layout';

const kindNames = { prepare: '合成配音与时间轴', render: '导出完整视频', sample: '场景配音试听' };
const statusNames = { queued: '等待中', running: '正在制作', succeeded: '已完成', failed: '制作失败', cancelled: '已取消' };
const tabs = [{ id: 'scenes', label: '分镜', icon: MovieCreationOutlined }, { id: 'sources', label: '资料', icon: ArticleOutlined }, { id: 'voice', label: '配音与风格', icon: GraphicEqRounded }, { id: 'exports', label: '导出记录', icon: FileDownloadOutlined }] as const;
type Tab = typeof tabs[number]['id'];
const formatTime = (seconds: number) => `${Math.floor(Math.max(0, seconds || 0) / 60).toString().padStart(2, '0')}:${Math.floor(Math.max(0, seconds || 0) % 60).toString().padStart(2, '0')}`;
const newId = (prefix: string) => `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
const downloadUrl = (url: string) => `${url}${url.includes('?') ? '&' : '?'}download=1`;
const newCard = (): Card => ({ id: newId('card'), label: '资讯', title: '新卡片', body: '在这里补充需要展示的内容。' });
const newScene = (): Scene => { const card = newCard(); return { id: newId('scene'), section: '新章节', kind: 'news', title: '新的资讯分镜', subtitle: '', kicker: '资讯', metric: '', cards: [card], narration: '在这里填写这一段的口播内容。', sourceIds: [], transition: 'classic', focus: [{ at: 0, cardId: card.id, transition: 'classic' }] }; };
async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers }, cache: 'no-store' });
  const data = await response.json();
  if (!response.ok) throw new Error(response.status === 409 ? `保存冲突：${data.error || '项目已被其他窗口修改'}。请先复制当前草稿备份，或重新载入已保存版本。` : data.error || `请求失败（${response.status}）`);
  return data as T;
}
function IconButton({ title, onClick, disabled, children, className = '' }: { title: string; onClick: () => void; disabled?: boolean; children: React.ReactNode; className?: string }) { return <button type="button" className={`icon-button ${className}`} title={title} aria-label={title} onClick={onClick} disabled={disabled}>{children}</button>; }
function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) { return <label className="field"><span className="field-label">{label}</span>{children}{hint && <small>{hint}</small>}</label>; }
function TransitionSelect({ value, onChange, scene = false }: { value: Transition; onChange: (value: Transition) => void; scene?: boolean }) { return <select aria-label={scene ? '章节转场' : '卡片切换'} value={value} onChange={event => onChange(event.target.value as Transition)}>{TRANSITIONS.filter(item => scene || item.id !== 'ticket-wipe').map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>; }

export default function Studio() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [savedSnapshot, setSavedSnapshot] = useState('');
  const [preview, setPreview] = useState<PreviewInfo | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [tab, setTab] = useState<Tab>('scenes');
  const [sceneId, setSceneId] = useState('');
  const [cardId, setCardId] = useState('');
  const [editorMode, setEditorMode] = useState<'content' | 'motion'>('content');
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [frameReady, setFrameReady] = useState(false);
  const [frameError, setFrameError] = useState('');
  const [imageUploads, setImageUploads] = useState(0);
  const imageUploadCount = useRef(0);
  const [newDialog, setNewDialog] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newGame, setNewGame] = useState<Game>('starrail');
  const [newTemplate, setNewTemplate] = useState<'blank' | 'starrail-weekly'>('blank');
  const [sourceUrl, setSourceUrl] = useState('');
  const [sourceText, setSourceText] = useState('');
  const [sourceTitle, setSourceTitle] = useState('');
  const [sourceId, setSourceId] = useState('');
  const [replaceScenes, setReplaceScenes] = useState(false);
  const [sampleAudio, setSampleAudio] = useState('');
  const iframe = useRef<HTMLIFrameElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const player = useRef<HTMLDivElement>(null);
  const currentTime = useRef(0);
  const activeProject = useRef<Project | null>(null);
  const saved = useRef('');
  const requestGeneration = useRef(0);
  const dirty = useMemo(() => Boolean(project && JSON.stringify(project) !== savedSnapshot), [project, savedSnapshot]);
  activeProject.current = project;
  saved.current = savedSnapshot;
  const selectedScene = project?.scenes.find(scene => scene.id === sceneId) || project?.scenes[0];
  const selectedCard = selectedScene?.cards.find(card => card.id === cardId) || selectedScene?.cards[0];
  const sceneIndex = project?.scenes.findIndex(scene => scene.id === selectedScene?.id) ?? -1;
  const duration = preview?.duration || 0;
  const canPlayAudio = Boolean(preview?.ready && !preview.stale && preview.audioUrl);
  const activeJobs = jobs.filter(job => job.status === 'running' || job.status === 'queued');
  const activeJob = activeJobs[0];
  const latestRender = jobs.find(job => job.kind === 'render' && job.status === 'succeeded' && job.outputs?.video);
  const sceneTimes = preview?.sceneTimes || [];
  const playingScene = sceneTimes.find(item => time >= item.start && time < item.start + item.duration);
  const selectedTiming = sceneTimes.find(item => item.id === selectedScene?.id);
  const game = GAMES.find(item => item.id === project?.game) || GAMES[0];

  const syncCardSizes = useCallback(() => {
    const current = activeProject.current;
    if (!current) return;
    const sizes = current.scenes.flatMap(scene => scene.cards.map((card, index) => ({
      sceneId: scene.id, cardId: card.id, ...getCardSize(card, index, current.presentation.cardScale),
    })));
    iframe.current?.contentWindow?.postMessage({ type: 'moyo:card-sizes', sizes }, window.location.origin);
  }, []);
  useEffect(() => { if (frameReady) syncCardSizes(); }, [project, frameReady, syncCardSizes]);

  const seek = useCallback((next: number) => {
    const bounded = Math.max(0, Math.min(next, preview?.duration || 0));
    currentTime.current = bounded;
    setTime(bounded);
    if (audio.current && canPlayAudio && Number.isFinite(audio.current.duration)) audio.current.currentTime = bounded;
    iframe.current?.contentWindow?.postMessage({ type: 'moyo:seek', time: bounded }, window.location.origin);
  }, [preview?.duration, canPlayAudio]);
  const togglePlay = useCallback(() => {
    if (!duration || !frameReady) return;
    if (playing) { audio.current?.pause(); setPlaying(false); return; }
    if (currentTime.current >= duration - .1) seek(0);
    if (canPlayAudio && audio.current) audio.current.play().then(() => setPlaying(true)).catch(reason => setError(`无法播放配音：${reason.message}`));
    else setPlaying(true);
  }, [playing, duration, frameReady, seek, canPlayAudio]);

  const adopt = useCallback((data: ProjectResponse, reset: boolean) => {
    setProject(data.project); setSavedSnapshot(JSON.stringify(data.project)); setPreview(data.preview); setJobs(data.jobs);
    try { localStorage.setItem('moyo:last-project', data.project.id); const url = new URL(window.location.href); url.searchParams.set('project', data.project.id); window.history.replaceState(null, '', url); } catch { /* The project remains usable when browser storage is unavailable. */ }
    setProjects(items => [data.project, ...items.filter(item => item.id !== data.project.id)]);
    if (reset) { setSceneId(data.project.scenes[0]?.id || ''); setCardId(''); setTime(0); currentTime.current = 0; setPlaying(false); setSampleAudio(''); }
  }, []);
  const loadProject = useCallback(async (id: string) => {
    const generation = ++requestGeneration.current;
    setLoading(true); setError(''); setPlaying(false); audio.current?.pause();
    try { const data = await api<ProjectResponse>(`/api/projects/${id}`); if (generation === requestGeneration.current) adopt(data, true); }
    catch (reason) { setError((reason as Error).message); }
    finally { if (generation === requestGeneration.current) setLoading(false); }
  }, [adopt]);
  useEffect(() => {
    let disposed = false;
    api<{ projects: Project[]; jobs: Job[]; capabilities: Capability[] }>('/api/projects').then(async data => {
      if (disposed) return;
      setProjects(data.projects); setCapabilities(data.capabilities);
      if (data.projects.length) {
        let previous = ''; try { previous = localStorage.getItem('moyo:last-project') || ''; } catch { /* Use default when browser storage is disabled. */ }
        const requested = new URL(window.location.href).searchParams.get('project');
        const selected = [requested, previous, 'starrail-demo'].find(id => data.projects.some(item => item.id === id));
        await loadProject(selected || data.projects[0].id);
      } else setLoading(false);
    }).catch(reason => { if (!disposed) { setError(reason.message); setLoading(false); } });
    return () => { disposed = true; };
  }, [loadProject]);
  useEffect(() => { if (!dirty) return; const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; }; window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn); }, [dirty]);
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(''), 6500); return () => window.clearTimeout(timer); }, [notice]);
  useEffect(() => {
    const handle = (event: MessageEvent) => {
      if (event.source !== iframe.current?.contentWindow || event.origin !== window.location.origin) return;
      if (event.data?.type === 'moyo:ready') { setFrameReady(true); setFrameError(''); syncCardSizes(); iframe.current?.contentWindow?.postMessage({ type: 'moyo:seek', time: currentTime.current }, window.location.origin); }
      if (event.data?.type === 'moyo:error') { const message = typeof event.data.error === 'string' ? event.data.error : '图片或画面加载失败'; setFrameReady(false); setFrameError(message); setPlaying(false); audio.current?.pause(); setError(`视频预览失败：${message}`); }
      if (event.data?.type === 'moyo:toggle') togglePlay();
      if (event.data?.type === 'moyo:jump') seek(Number(event.data.time) || 0);
    };
    window.addEventListener('message', handle); return () => window.removeEventListener('message', handle);
  }, [togglePlay, seek, syncCardSizes]);
  useEffect(() => {
    if (!playing) return;
    let frame = 0; let last = performance.now(); let lastUiUpdate = 0;
    const tick = (now: number) => {
      const next = Math.min(duration, canPlayAudio && audio.current ? audio.current.currentTime : currentTime.current + Math.min(.1, (now - last) / 1000));
      last = now; currentTime.current = next;
      iframe.current?.contentWindow?.postMessage({ type: 'moyo:seek', time: next }, window.location.origin);
      if (now - lastUiUpdate > 100) { setTime(next); lastUiUpdate = now; }
      if (next >= duration) { setPlaying(false); setTime(duration); audio.current?.pause(); return; }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick); return () => cancelAnimationFrame(frame);
  }, [playing, canPlayAudio, duration]);
  const refreshJobData = useCallback(async () => {
    const current = activeProject.current;
    if (!current) return;
    const data = await api<ProjectResponse>(`/api/projects/${current.id}`);
    if (activeProject.current?.id !== current.id) return;
    setJobs(data.jobs); setPreview(data.preview);
    const newestSample = data.jobs.find(job => job.kind === 'sample' && job.status === 'succeeded' && job.outputs?.audio);
    if (newestSample) setSampleAudio(newestSample.outputs!.audio!);
  }, []);
  useEffect(() => {
    if (!project?.id || !activeJobs.length) return;
    let disposed = false; let running = false;
    const timer = setInterval(async () => {
      if (running) return; running = true;
      try { if (!disposed) await refreshJobData(); } catch (reason) { if (!disposed) setError((reason as Error).message); } finally { running = false; }
    }, 1500);
    return () => { disposed = true; clearInterval(timer); };
  }, [project?.id, activeJobs.length, refreshJobData]);

  const edit = (apply: (draft: Project) => void) => { setProject(current => { if (!current) return current; const draft = structuredClone(current); apply(draft); return draft; }); };
  const editScene = (apply: (draft: Scene) => void) => edit(draft => { const scene = draft.scenes.find(item => item.id === selectedScene?.id); if (scene) apply(scene); });
  const editCard = (apply: (draft: Card) => void) => editScene(draft => { const card = draft.cards.find(item => item.id === selectedCard?.id); if (card) apply(card); });
  const changeCardImage = (target: CardImageTarget, image: Card['image']) => {
    const current = activeProject.current;
    const targetCard = current?.id === target.projectId ? current.scenes.find(scene => scene.id === target.sceneId)?.cards.find(card => card.id === target.cardId) : undefined;
    if (!targetCard) { setNotice('图片已保留在素材库，原卡片已删除或项目已切换，请从素材库重新选择。'); return; }
    const newAsset = image && image.assetId !== targetCard.image?.assetId;
    setProject(existing => {
      if (!existing || existing.id !== target.projectId) return existing;
      const draft = structuredClone(existing);
      const card = draft.scenes.find(scene => scene.id === target.sceneId)?.cards.find(card => card.id === target.cardId);
      if (!card) return existing;
      if (image) card.image = image; else delete card.image;
      return draft;
    });
    if (newAsset) setNotice(`已为「${target.cardTitle}」添加图片，保存后应用到预览`);
  };
  const trackImageUpload = useCallback((change: 1 | -1) => { imageUploadCount.current = Math.max(0, imageUploadCount.current + change); setImageUploads(imageUploadCount.current); }, []);
  const execute = async (label: string, operation: () => Promise<void>) => { if (busy) return; setBusy(label); setError(''); try { await operation(); } catch (reason) { setError((reason as Error).message); } finally { setBusy(''); } };
  const saveProject = async (draft?: Project): Promise<Project | null> => {
    if (imageUploadCount.current) throw new Error('图片正在上传，请等上传完成后保存或导出。');
    const current = draft || activeProject.current;
    if (!current) return null;
    if (JSON.stringify(current) === saved.current) return current;
    setPlaying(false); audio.current?.pause();
    const data = await api<ProjectResponse>(`/api/projects/${current.id}`, { method: 'PUT', body: JSON.stringify({ project: current, expectedRevision: current.revision }) });
    adopt(data, false); setNotice('更改已保存，预览已更新'); return data.project;
  };
  const startJob = (kind: JobKind, targetScene?: string) => execute(kindNames[kind], async () => {
    const current = await saveProject(); if (!current) return;
    const data = await api<{ job: Job }>(`/api/projects/${current.id}/jobs`, { method: 'POST', body: JSON.stringify({ kind, ...(kind === 'sample' ? { sceneId: targetScene || selectedScene?.id } : {}) }) });
    setJobs(items => [data.job, ...items.filter(item => item.id !== data.job.id)]); setNotice(`${kindNames[kind]}任务已加入队列`); if (kind === 'render') setTab('exports');
  });
  const createProject = () => execute('正在创建', async () => {
    if (imageUploadCount.current) throw new Error('请等待图片上传完成后创建项目。');
    if (dirty && !window.confirm('当前更改尚未保存。创建新项目会离开当前草稿，继续吗？')) return;
    const data = await api<{ project: Project }>('/api/projects', { method: 'POST', body: JSON.stringify({ template: newTemplate, game: newGame, title: newTitle.trim() || '新一期米游资讯' }) });
    setNewDialog(false); await loadProject(data.project.id); setTab('scenes'); setNotice('项目已创建');
  });
  const duplicateProject = () => execute('正在复制', async () => {
    if (imageUploadCount.current) throw new Error('请等待图片上传完成后复制项目。');
    if (!project) return;
    // Duplicate the saved project first, then persist the current draft into the copy, including during revision conflicts.
    const data = await api<{ project: Project }>('/api/projects', { method: 'POST', body: JSON.stringify({ template: 'duplicate', sourceId: project.id, title: `${project.title} · 副本` }) });
    const copy = { ...structuredClone(project), id: data.project.id, title: data.project.title, revision: data.project.revision, createdAt: data.project.createdAt, updatedAt: data.project.updatedAt };
    const response = await api<ProjectResponse>(`/api/projects/${copy.id}`, { method: 'PUT', body: JSON.stringify({ project: copy, expectedRevision: copy.revision }) });
    adopt(response, true); setNotice('已复制当前内容，新副本可独立编辑');
  });
  const chooseScene = (id: string) => { setSceneId(id); setCardId(''); const timing = sceneTimes.find(item => item.id === id); if (timing) seek(timing.start); };
  const chooseCard = (id: string) => {
    setCardId(id);
    const cueIndex = selectedScene?.focus.findIndex(item => item.cardId === id) ?? -1;
    if (!selectedScene || !selectedTiming || cueIndex < 0) return;
    const cue = selectedScene.focus[cueIndex];
    const next = selectedScene.focus[cueIndex + 1]?.at ?? 1;
    const settle = Math.min(.8, Math.max(0, (next - cue.at) * selectedTiming.duration / 2));
    seek(selectedTiming.start + cue.at * selectedTiming.duration + settle);
  };
  const moveScene = (offset: number) => edit(draft => { const index = draft.scenes.findIndex(item => item.id === selectedScene?.id); const target = index + offset; if (target >= 0 && target < draft.scenes.length) [draft.scenes[index], draft.scenes[target]] = [draft.scenes[target], draft.scenes[index]]; });
  const addScene = () => { const scene = newScene(); edit(draft => draft.scenes.splice(sceneIndex + 1, 0, scene)); setSceneId(scene.id); setCardId(''); };
  const removeScene = () => { if (!selectedScene || !window.confirm(`删除分镜「${selectedScene.title}」及其卡片？保存后生效。`)) return; edit(draft => { draft.scenes = draft.scenes.filter(scene => scene.id !== selectedScene.id); }); setSceneId(project?.scenes[Math.max(0, sceneIndex - 1)]?.id || ''); setCardId(''); };
  const addCard = () => { const card = newCard(); editScene(scene => { scene.cards.push(card); const last = scene.focus.at(-1)?.at || 0; if (last < .98) scene.focus.push({ at: (last + .98) / 2, cardId: card.id, transition: 'classic' }); }); setCardId(card.id); };
  const removeCard = () => { if (!selectedCard) return; editScene(scene => { scene.cards = scene.cards.filter(card => card.id !== selectedCard.id); scene.focus = scene.focus.filter(focus => focus.cardId !== selectedCard.id); if (scene.focus[0]) scene.focus[0].at = 0; else scene.focus = [{ at: 0, cardId: scene.cards[0].id, transition: 'classic' }]; }); setCardId(''); };
  const moveCard = (offset: number) => editScene(scene => { const index = scene.cards.findIndex(item => item.id === selectedCard?.id); const target = index + offset; if (target >= 0 && target < scene.cards.length) [scene.cards[index], scene.cards[target]] = [scene.cards[target], scene.cards[index]]; });
  const importSource = () => execute('正在读取网页', async () => {
    if (!sourceUrl.trim()) throw new Error('请先输入公开网页链接');
    const data = await api<{ source: Source }>('/api/sources/import', { method: 'POST', body: JSON.stringify({ url: sourceUrl.trim() }) });
    edit(draft => draft.sources.push(data.source)); setSourceId(data.source.id); setSourceText(data.source.text || ''); setSourceTitle(data.source.title); setNotice('网页原文已导入，保存后可用于整理分镜');
  });
  const addPastedSource = () => {
    if (!sourceText.trim()) { setError('请先粘贴资料原文'); return; }
    const source: Source = { id: newId('source'), title: sourceTitle.trim() || '手动导入资料', url: sourceUrl.trim(), publisher: '', date: '', note: '用户手动粘贴，尚未核实', text: sourceText, status: 'unverified' };
    edit(draft => draft.sources.push(source)); setSourceId(source.id); setNotice('资料已加入项目，点击保存即可保留');
  };
  const compose = () => execute('正在整理分镜', async () => {
    if (!sourceText.trim()) throw new Error('请粘贴资料，或从左侧选择一份已有资料');
    if (replaceScenes && !window.confirm('将用资料重新生成草稿分镜，替换当前全部分镜。确认继续吗？')) return;
    const draft = structuredClone(activeProject.current!);
    let linkedSource = draft.sources.find(item => item.id === sourceId);
    if (!linkedSource) { linkedSource = { id: newId('source'), title: sourceTitle.trim() || '手动导入资料', url: sourceUrl.trim(), publisher: '', date: '', note: '用户导入，尚未核实', status: 'unverified' }; draft.sources.push(linkedSource); }
    linkedSource.text = sourceText; linkedSource.title = sourceTitle.trim() || linkedSource.title; linkedSource.url = sourceUrl.trim();
    const current = await saveProject(draft); if (!current) return;
    setSourceId(linkedSource.id);
    const data = await api<ProjectResponse>(`/api/projects/${current.id}/compose`, { method: 'POST', body: JSON.stringify({ text: sourceText, sourceId: linkedSource.id, replace: replaceScenes }) });
    adopt(data, true); setTab('scenes'); setNotice('已按段落整理为草稿，请检查事实并调整口播');
  });
  const source = project?.sources.find(item => item.id === sourceId);
  const selectSource = (item: Source) => { setSourceId(item.id); setSourceText(item.text || item.note); setSourceUrl(item.url); setSourceTitle(item.title); };
  const handlePreviewLoad = () => {
    try {
      const document = iframe.current?.contentDocument;
      if (document?.contentType.includes('application/json')) {
        const failure = JSON.parse(document.body?.textContent || '{}');
        const message = typeof failure.error === 'string' ? failure.error : '画面资源未能读取';
        setFrameReady(false); setFrameError(message); setPlaying(false); audio.current?.pause(); setError(`视频预览失败：${message}`);
        return;
      }
      syncCardSizes();
      iframe.current?.contentWindow?.postMessage({ type: 'moyo:seek', time: currentTime.current }, window.location.origin);
    } catch (reason) {
      const message = `无法读取视频预览：${(reason as Error).message}`;
      setFrameReady(false); setFrameError(message); setPlaying(false); audio.current?.pause(); setError(message);
    }
  };
  const previewKey = `${project?.id}-${project?.revision}-${preview?.audioUrl || ''}-${preview?.ready}-${preview?.stale}`;
  useEffect(() => { setFrameReady(false); setFrameError(''); setPlaying(false); audio.current?.pause(); const next = Math.min(currentTime.current, duration); currentTime.current = next; setTime(next); }, [previewKey, duration]);

  return <div className="studio-shell">
    <header className="topbar">
      <div className="brand"><span className="brand-mark"><MovieCreationOutlined /></span><div><strong>miyo<span> · </span>米游创作</strong><small>资讯视频工作台</small></div></div>
      <div className="project-switcher"><select aria-label="选择项目" value={project?.id || ''} disabled={!!busy || loading || imageUploads > 0} onChange={event => { if (!dirty || window.confirm('当前更改尚未保存，离开并载入另一个项目吗？')) void loadProject(event.target.value); }}>{!project && <option value="">选择项目</option>}{projects.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select><span className={`save-status ${dirty ? 'is-dirty' : ''}`}>{dirty ? '未保存更改' : project ? `已保存 · v${project.revision}` : '本地项目'}</span></div>
      <div className="top-actions"><button onClick={() => setNewDialog(true)} disabled={!!busy || imageUploads > 0}><Add />新建</button><IconButton title="复制当前项目（含未保存更改）" disabled={!project || !!busy || imageUploads > 0} onClick={duplicateProject}><ContentCopyOutlined /></IconButton><button onClick={() => execute('正在保存', async () => { await saveProject(); })} disabled={!dirty || !!busy || imageUploads > 0}><SaveOutlined />保存</button><button className="primary" onClick={() => startJob('render')} disabled={!project || !!busy || imageUploads > 0 || activeJobs.length > 0}><FileDownloadOutlined />导出视频</button></div>
    </header>
    {error && <div className="message error" role="alert"><span>{error}</span><div>{error.includes('保存冲突') && <button onClick={duplicateProject}>复制草稿</button>}<IconButton title="关闭提示" onClick={() => setError('')}><CloseRounded /></IconButton></div></div>}
    {notice && <div className="toast" role="status"><CheckRounded />{notice}</div>}
    <nav className="workspace-nav" aria-label="工作区"><div className="tab-group">{tabs.map(item => <button key={item.id} className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)}><item.icon />{item.label}{item.id === 'exports' && activeJobs.length > 0 && <span className="count-badge">{activeJobs.length}</span>}</button>)}</div><span className="workspace-meta">本地制作<span>·</span>1920 × 1080<span>·</span>24 帧 / 秒</span></nav>
    {loading && !project ? <main className="loading-workspace"><div className="skeleton sidebar-skeleton" /><div className="skeleton preview-skeleton" /><div className="skeleton editor-skeleton" /><p>正在打开本地项目…</p></main> : !project ? <main className="empty-workspace"><MovieCreationOutlined /><h1>从一份资讯，开始制作</h1><p>创建项目后，整理分镜、试听配音，再导出完整视频。</p><button className="primary" onClick={() => setNewDialog(true)}><Add />创建视频项目</button>{error && <button onClick={() => window.location.reload()}><RefreshRounded />重新加载</button>}</main> : <>
      <main className={`workspace ${tab !== 'scenes' ? 'workspace-secondary' : ''}`} aria-busy={!!busy || loading}>
        <aside className="scene-sidebar">
          <div className="panel-heading"><div><h2>{tab === 'sources' ? '资料库' : '分镜列表'}</h2><small>{tab === 'sources' ? `${project.sources.length} 份来源` : `${project.scenes.length} 个分镜 · ${formatTime(duration)}`}</small></div>{tab === 'sources' ? <IconButton title="新建粘贴资料" onClick={() => { setSourceId(''); setSourceTitle(''); setSourceUrl(''); setSourceText(''); }}><Add /></IconButton> : <IconButton title="添加分镜" onClick={addScene} disabled={!!busy || project.scenes.length >= 40}><Add /></IconButton>}</div>
          <div className="scene-scroll">
            {tab === 'sources' ? <>{project.sources.map((item, index) => <button key={item.id} className={`source-item ${sourceId === item.id ? 'selected' : ''}`} onClick={() => selectSource(item)}><span className="scene-number">{(index + 1).toString().padStart(2, '0')}</span><div><strong>{item.title}</strong><small>{item.publisher || '手动资料'} · {item.date || '日期待核实'}</small><span className={`source-state ${item.status}`}>{item.status === 'verified' ? '已人工核实' : item.status === 'community' ? '社区观点' : '待核实'}</span></div></button>)}{!project.sources.length && <p className="empty-inline">导入公开网页，或粘贴资料原文。</p>}</> : project.scenes.map((scene, index) => <button key={scene.id} className={`scene-item ${selectedScene?.id === scene.id ? 'selected' : ''} ${playingScene?.id === scene.id ? 'on-air' : ''}`} onClick={() => chooseScene(scene.id)}><div className={`scene-thumbnail game-${project.game}`}><span>{(index + 1).toString().padStart(2, '0')}</span><div className="mini-lines"><i /><i /><i /></div></div><div className="scene-description"><span>{scene.section}</span><strong>{scene.title || '未命名分镜'}</strong><small>{scene.cards.length} 张卡片 · {formatTime(sceneTimes.find(item => item.id === scene.id)?.duration || 0)}</small></div></button>)}
          </div>
          <div className="sidebar-footer">{tab === 'sources' ? <span>来源和原文随项目保存</span> : <><IconButton title="分镜上移" disabled={sceneIndex <= 0 || !!busy} onClick={() => moveScene(-1)}><ArrowUpwardRounded /></IconButton><IconButton title="分镜下移" disabled={sceneIndex >= project.scenes.length - 1 || !!busy} onClick={() => moveScene(1)}><ArrowDownwardRounded /></IconButton><IconButton title="删除当前分镜" disabled={project.scenes.length <= 1 || !!busy} onClick={removeScene}><DeleteOutlineRounded /></IconButton><span>选中分镜可编辑</span></>}</div>
        </aside>
        <section className="canvas-area">
          <div className="canvas-heading"><div><span className="game-dot" style={{ background: game.color }} /><h1>{project.title}</h1></div><span className={`preview-state ${canPlayAudio ? 'ready' : ''}`}>{dirty ? '有未保存更改' : canPlayAudio ? '配音已同步' : preview?.stale ? '内容已变更，待合成' : '估算时间轴 · 无配音'}</span></div>
          <div className="player-stage" ref={player}>
            {preview && <iframe ref={iframe} title="视频画面预览" key={previewKey} src={`${preview.url}${preview.url.includes('?') ? '&' : '?'}v=${encodeURIComponent(previewKey)}`} allow="autoplay; fullscreen" onLoad={handlePreviewLoad} />}
            {!frameReady && <div className={`preview-loading ${frameError ? 'preview-failed' : ''}`}>{frameError ? <><span>画面加载失败</span><small>{frameError}</small><button onClick={() => { setFrameError(''); if (iframe.current) iframe.current.src = iframe.current.src; }}>重新加载画面</button></> : <><div className="loading-bar" /><span>正在加载画面</span></>}</div>}
          </div>
          <div className="player-controls"><div className="playback-buttons"><IconButton title="上一个分镜" disabled={!frameReady} onClick={() => { const previous = [...sceneTimes].reverse().find(item => item.start < time - .5); seek(previous?.start || 0); }}><SkipPreviousRounded /></IconButton><IconButton title={playing ? '暂停' : '播放预览'} className="play-button" disabled={!frameReady || !duration} onClick={togglePlay}>{playing ? <PauseRounded /> : <PlayArrowRounded />}</IconButton><IconButton title="下一个分镜" disabled={!frameReady} onClick={() => seek(sceneTimes.find(item => item.start > time + .2)?.start ?? duration)}><SkipNextRounded /></IconButton><span className="time-code">{formatTime(time)}<span> / {formatTime(duration)}</span></span></div><div className="preview-actions"><span>{canPlayAudio ? `${project.voice.speed} 倍速配音` : '可先预览画面'}</span><IconButton title="全屏预览" onClick={() => { if (document.fullscreenElement) void document.exitFullscreen(); else void player.current?.requestFullscreen(); }}><FullscreenRounded /></IconButton></div></div>
          <div className="timeline"><div className="timeline-heading"><span>视频时间轴</span><small>{canPlayAudio ? '配音 · 字幕 · 动画同步' : '合成配音后更新实际时长'}</small></div><div className="timeline-ruler"><span>00:00</span><span>{formatTime(duration / 4)}</span><span>{formatTime(duration / 2)}</span><span>{formatTime(duration * .75)}</span><span>{formatTime(duration)}</span></div><div className="timeline-tracks"><div className="scene-track">{sceneTimes.map((item, index) => <button key={item.id} title={`${project.scenes.find(scene => scene.id === item.id)?.title} ${formatTime(item.start)}`} className={selectedScene?.id === item.id ? 'selected' : ''} style={{ width: `${duration ? item.duration / duration * 100 : 0}%` }} onClick={() => chooseScene(item.id)}><span>{(index + 1).toString().padStart(2, '0')}</span></button>)}</div><div className={`voice-track ${canPlayAudio ? 'has-voice' : ''}`}><GraphicEqRounded /><span>{canPlayAudio ? (project.voice.preset === 'kiana-base' ? '琪亚娜 · 稳重轻角色感' : '晓晓 · 普通话') : '尚未生成当前版本的配音'}</span></div><div className="timeline-playhead" style={{ left: `${duration ? time / duration * 100 : 0}%` }}><span /></div></div><input className="timeline-seek" type="range" min="0" max={duration || 1} step="0.01" value={Math.min(time, duration || 0)} onChange={event => seek(Number(event.target.value))} aria-label="拖动视频播放时间" /></div>
          {activeJob && <div className="active-job"><div><span className="job-pulse" /><strong>{kindNames[activeJob.kind]}</strong><span>{activeJob.message || activeJob.stage}</span><b>{Math.round(activeJob.progress)}%</b></div><progress max="100" value={activeJob.progress} /><button onClick={() => setTab('exports')}>查看任务</button></div>}
          {!activeJob && <div className="canvas-note"><span>{/2026[./-]10[./-]02/.test(project.cutoff) ? '历史示例 · 资料截至 2026.10.02，请在新一期更新来源与日期。' : `${project.period || '报道日期待填写'} · ${project.cutoff.startsWith('资料') ? project.cutoff : `资料截至 ${project.cutoff || '待填写'}`}`}</span><button onClick={() => startJob('prepare')} disabled={!!busy}><GraphicEqRounded />合成配音预览</button></div>}
          {preview?.audioUrl && <audio ref={audio} src={canPlayAudio ? preview.audioUrl : undefined} preload="metadata" onLoadedMetadata={() => { if (audio.current && Number.isFinite(audio.current.duration)) audio.current.currentTime = Math.min(currentTime.current, audio.current.duration); }} onEnded={() => { setPlaying(false); setTime(duration); }} onError={() => { if (canPlayAudio) setError('配音文件读取失败，请查看导出记录或重新合成。'); }} />}
        </section>
        <aside className="inspector">
          {tab === 'scenes' && selectedScene ? <><div className="panel-heading"><div><h2>分镜 {String(sceneIndex + 1).padStart(2, '0')}</h2><small>{selectedScene.section}</small></div><TuneRounded /></div><div className="editor-tabs"><button className={editorMode === 'content' ? 'active' : ''} onClick={() => setEditorMode('content')}>内容</button><button className={editorMode === 'motion' ? 'active' : ''} onClick={() => setEditorMode('motion')}>聚焦与转场</button></div><fieldset disabled={!!busy || loading} className="inspector-fields">
            {editorMode === 'content' ? <><Field label="分镜类型"><select value={selectedScene.kind} onChange={event => editScene(scene => { scene.kind = event.target.value as Scene['kind']; })}><option value="intro">开场导览</option><option value="news">资讯动态</option><option value="event">活动与行程</option><option value="community">社区观点</option><option value="outro">结尾备忘</option></select></Field><Field label="章节名称"><input value={selectedScene.section} onChange={event => editScene(scene => { scene.section = event.target.value; })} /></Field><Field label="分镜标题"><input value={selectedScene.title} onChange={event => editScene(scene => { scene.title = event.target.value; })} /></Field><div className="field-grid"><Field label="栏目标签"><input value={selectedScene.kicker} onChange={event => editScene(scene => { scene.kicker = event.target.value; })} /></Field><Field label="角标"><input value={selectedScene.metric} onChange={event => editScene(scene => { scene.metric = event.target.value; })} placeholder="例如 10.02" /></Field></div>
              <div className="editor-section-heading"><h3>画面卡片</h3><button onClick={addCard} disabled={selectedScene.cards.length >= 6}><Add />添加</button></div><div className="card-tabs">{selectedScene.cards.map((card, index) => <button key={card.id} className={selectedCard?.id === card.id ? 'active' : ''} onClick={() => chooseCard(card.id)} title={card.title}>{index + 1}</button>)}<button className="card-image-shortcut" title="编辑当前卡片配图" aria-label="编辑当前卡片配图" onClick={() => document.querySelector('.inspector .card-image-editor')?.scrollIntoView({ block: 'nearest' })}><ImageOutlined />配图</button></div>
              {selectedCard && <div className="card-editor"><Field label="卡片标签"><input value={selectedCard.label} onChange={event => editCard(card => { card.label = event.target.value; })} /></Field><Field label="卡片标题"><input value={selectedCard.title} onChange={event => editCard(card => { card.title = event.target.value; })} /></Field><CardSizeEditor card={selectedCard} cardIndex={selectedScene.cards.findIndex(card => card.id === selectedCard.id)} cardScale={project.presentation.cardScale} onChange={size => editCard(card => { if (size) card.size = size; else delete card.size; })} /><Field label="卡片正文" hint="建议 2～4 行，使用换行分段。"><textarea rows={5} value={selectedCard.body} onChange={event => editCard(card => { card.body = event.target.value; })} /></Field><CardImageEditor target={{ projectId: project.id, sceneId: selectedScene.id, cardId: selectedCard.id, cardTitle: selectedCard.title }} card={selectedCard} disabled={!!busy || loading || imageUploads > 0} dirty={dirty} onChange={changeCardImage} onUploadState={trackImageUpload} onError={setError} onNotice={setNotice} onApply={() => { void execute('正在应用配图', async () => { await saveProject(); }); }} /><div className="card-tools"><IconButton title="卡片前移" onClick={() => moveCard(-1)} disabled={selectedScene.cards[0].id === selectedCard.id}><ArrowUpwardRounded /></IconButton><IconButton title="卡片后移" onClick={() => moveCard(1)} disabled={selectedScene.cards.at(-1)?.id === selectedCard.id}><ArrowDownwardRounded /></IconButton><span>{selectedCard.body.length} 字</span><IconButton title="删除卡片" onClick={removeCard} disabled={selectedScene.cards.length <= 1}><DeleteOutlineRounded /></IconButton></div></div>}
              <div className="editor-section-heading"><h3>口播稿</h3><button onClick={() => startJob('sample', selectedScene.id)} disabled={activeJobs.length > 0}><HeadphonesRounded />试听这段</button></div><Field label="按语义自然断句" hint="口播和画面文案独立保存，配音时会保留标点与分段。"><textarea className="narration-input" rows={6} value={selectedScene.narration} onChange={event => editScene(scene => { scene.narration = event.target.value; })} /></Field>{sampleAudio && <audio className="sample-player" controls src={sampleAudio} />}
              <details className="source-links"><summary>关联资讯来源（{selectedScene.sourceIds.length}）</summary>{project.sources.map(item => <label className="check-row" key={item.id}><input type="checkbox" checked={selectedScene.sourceIds.includes(item.id)} onChange={event => editScene(scene => { scene.sourceIds = event.target.checked ? [...scene.sourceIds, item.id] : scene.sourceIds.filter(id => id !== item.id); })} /><span>{item.title}</span></label>)}{!project.sources.length && <p>前往资料页添加来源。</p>}</details></> : <><Field label="进入此分镜时的章节转场" hint={project.game === 'starrail' ? '「章节幕切」保留金色车票横扫与青色光边。' : '章节幕切将使用当前游戏的专属视觉。'}><TransitionSelect scene value={selectedScene.transition} onChange={value => editScene(scene => { scene.transition = value; })} /></Field><div className="editor-section-heading"><h3>口播卡片聚焦</h3><button onClick={() => editScene(scene => { scene.focus = scene.cards.map((card, index) => ({ at: index / scene.cards.length, cardId: card.id, transition: index ? 'orbit' : 'classic' })); })}>均分重排</button></div><p className="help-text">百分比表示这一段配音的进度。切换卡片时使用各自的转场，首个聚焦点从 0% 开始。</p>{selectedScene.focus.map((focus, index) => <div className="focus-editor" key={`${selectedScene.id}-focus-${index}`}><div className="focus-top"><span>聚焦 {index + 1}</span><IconButton title="跳到该聚焦点" onClick={() => seek((selectedTiming?.start || 0) + (selectedTiming?.duration || 0) * focus.at)}><PlayArrowRounded /></IconButton><IconButton title="删除聚焦点" disabled={selectedScene.focus.length <= 1 || index === 0} onClick={() => editScene(scene => { scene.focus.splice(index, 1); })}><DeleteOutlineRounded /></IconButton></div><div className="field-grid"><Field label="开始进度 %"><input type="number" min="0" max="98" step="1" disabled={index === 0} value={Math.round(focus.at * 100)} onChange={event => editScene(scene => { scene.focus[index].at = Math.min(.98, Math.max(0, Number(event.target.value) / 100)); })} /></Field><Field label="聚焦卡片"><select value={focus.cardId} onChange={event => editScene(scene => { scene.focus[index].cardId = event.target.value; })}>{selectedScene.cards.map((card, cardIndex) => <option value={card.id} key={card.id}>{cardIndex + 1}. {card.title}</option>)}</select></Field></div><Field label="卡片切换动画"><TransitionSelect value={focus.transition === 'ticket-wipe' ? 'classic' : focus.transition} onChange={value => editScene(scene => { scene.focus[index].transition = value; })} /></Field></div>)}<button className="full-width" disabled={selectedScene.focus.length >= 60 || (selectedScene.focus.at(-1)?.at || 0) >= .98} onClick={() => editScene(scene => { scene.focus.push({ at: Math.min(.98, (scene.focus.at(-1)?.at || 0) + .1), cardId: scene.cards.at(-1)!.id, transition: 'classic' }); })}><Add />添加聚焦点</button><small className="help-text">保存时会检查时间顺序；修改已有时间点后，请保持从小到大。</small></>}
          </fieldset></> : tab === 'sources' ? <><div className="panel-heading"><div><h2>资讯资料</h2><small>保留来源，整理可编辑草稿</small></div><ArticleOutlined /></div><fieldset disabled={!!busy || loading} className="inspector-fields"><Field label="公开网页链接"><div className="inline-input"><input value={sourceUrl} onChange={event => setSourceUrl(event.target.value)} placeholder="https://…" /><button onClick={importSource} title="读取网页"><LinkRounded /></button></div></Field><Field label="资料标题"><input value={sourceTitle} onChange={event => setSourceTitle(event.target.value)} placeholder="例如：版本活动公告" /></Field><Field label="原文内容" hint="网页读取失败时可直接粘贴。请保留原文并核对来源日期。"><textarea rows={13} value={sourceText} onChange={event => setSourceText(event.target.value)} placeholder="粘贴资讯原文，以空行分段…" /></Field><div className="button-row"><button onClick={source ? () => { edit(draft => { const item = draft.sources.find(item => item.id === source.id)!; item.title = sourceTitle; item.url = sourceUrl; item.text = sourceText; }); setNotice('资料更改已加入草稿，请保存'); } : addPastedSource}><SaveOutlined />{source ? '更新资料' : '加入资料库'}</button>{source && <IconButton title="删除此资料及分镜中的关联" onClick={() => { if (!window.confirm('删除这份资料及其来源关联？分镜内容会保留。')) return; edit(draft => { draft.sources = draft.sources.filter(item => item.id !== source.id); draft.scenes.forEach(scene => { scene.sourceIds = scene.sourceIds.filter(id => id !== source.id); }); }); setSourceId(''); }}><DeleteOutlineRounded /></IconButton>}</div>{source && <><Field label="来源状态"><select value={source.status} onChange={event => edit(draft => { draft.sources.find(item => item.id === source.id)!.status = event.target.value as Source['status']; })}><option value="unverified">待核实</option><option value="verified">已人工核实</option><option value="community">社区观点</option></select></Field><div className="field-grid"><Field label="发布方"><input value={source.publisher} onChange={event => edit(draft => { draft.sources.find(item => item.id === source.id)!.publisher = event.target.value; })} /></Field><Field label="发布日期"><input value={source.date} onChange={event => edit(draft => { draft.sources.find(item => item.id === source.id)!.date = event.target.value; })} placeholder="YYYY-MM-DD" /></Field></div></>}<div className="compose-block"><h3>整理为分镜草稿</h3><p>按段落生成标题、卡片和口播初稿。此步骤不替代事实核对，生成后可以逐项编辑。</p><label className="check-row"><input type="checkbox" checked={replaceScenes} onChange={event => setReplaceScenes(event.target.checked)} />替换当前全部分镜</label><button className="primary full-width" onClick={compose} disabled={!sourceText.trim()}><MovieCreationOutlined />{replaceScenes ? '重新整理分镜' : '追加为分镜'}</button></div></fieldset></> : tab === 'voice' ? <><div className="panel-heading"><div><h2>配音与风格</h2><small>整期视频的制作设置</small></div><TuneRounded /></div><fieldset disabled={!!busy || loading} className="inspector-fields"><Field label="项目名称"><input value={project.title} onChange={event => edit(draft => { draft.title = event.target.value; })} /></Field><div className="field-grid"><Field label="报道日期"><input value={project.period} onChange={event => edit(draft => { draft.period = event.target.value; })} /></Field><Field label="资料截止"><input placeholder="YYYY-MM-DD" value={project.cutoff} onChange={event => edit(draft => { draft.cutoff = event.target.value; })} /></Field></div><div className="editor-section-heading"><h3>游戏风格</h3><span>四种独立视觉</span></div><div className="game-options">{GAMES.map(item => <button key={item.id} className={project.game === item.id ? 'selected' : ''} onClick={() => edit(draft => { draft.game = item.id; })}><span style={{ background: item.color }} /><div><strong>{item.name}</strong><small>{item.description}</small></div>{project.game === item.id && <CheckRounded />}</button>)}</div><Field label="配音声线"><select value={project.voice.preset} onChange={event => edit(draft => { draft.voice.preset = event.target.value as Project['voice']['preset']; })}><option value="kiana-base">琪亚娜 · 稳重轻角色感 v2 基准</option><option value="xiaoxiao">晓晓 · 普通话</option></select></Field><Field label={`语速 · ${project.voice.speed.toFixed(2)} 倍`}><input type="range" min="0.75" max="1.5" step="0.05" value={project.voice.speed} onChange={event => edit(draft => { draft.voice.speed = Number(event.target.value); })} /><div className="range-ends"><span>舒缓 0.75×</span><span>轻快 1.5×</span></div></Field><button onClick={() => startJob('sample', selectedScene?.id)} disabled={activeJobs.length > 0}><HeadphonesRounded />试听当前分镜</button>{sampleAudio && <audio className="sample-player" src={sampleAudio} controls />}<div className="editor-section-heading"><h3>画面与粒子</h3></div><Field label={`粒子密度 · ${Math.round(project.presentation.particles * 100)}%`}><input type="range" min="0" max="2" step="0.1" value={project.presentation.particles} onChange={event => edit(draft => { draft.presentation.particles = Number(event.target.value); })} /></Field><p className="help-text">卡片宽高可在「分镜 → 当前卡片 → 中间卡片尺寸」中独立调整。</p><Field label={`字幕字号 · ${project.presentation.captionSize}px`}><input type="range" min="18" max="48" step="1" value={project.presentation.captionSize} onChange={event => edit(draft => { draft.presentation.captionSize = Number(event.target.value); })} /></Field><div className="capabilities"><h3>本地工具状态</h3>{capabilities.map(item => <div key={item.id} title={item.detail}><span className={item.available ? 'available' : 'unavailable'}>{item.available ? '可用' : '未就绪'}</span><span>{item.label}</span></div>)}</div></fieldset></> : <><div className="panel-heading"><div><h2>制作与导出</h2><small>每次输出保留独立版本</small></div><FileDownloadOutlined /></div><div className="inspector-fields"><div className="export-summary"><h3>完整视频</h3><p>1080p · 24 帧 / 秒 · MP4</p><small>自动保存、合成配音、渲染画面并校验成片。</small><button className="primary full-width" onClick={() => startJob('render')} disabled={!!busy || activeJobs.length > 0}><FileDownloadOutlined />导出当前版本</button>{latestRender?.outputs?.video && <a className="button full-width" href={downloadUrl(latestRender.outputs.video)}><FileDownloadOutlined />下载最近成片 · v{latestRender.revision}</a>}</div><div className="editor-section-heading"><h3>任务记录</h3><IconButton title="刷新任务" onClick={() => execute('正在刷新', refreshJobData)} disabled={!!busy}><RefreshRounded /></IconButton></div>{jobs.length === 0 && <div className="empty-inline">还没有制作任务。可以先试听一段，再生成完整视频。</div>}{jobs.map(job => <article className={`job-item job-${job.status}`} key={job.id}><div className="job-title"><strong>{kindNames[job.kind]}</strong><span>{statusNames[job.status]}</span></div><small>项目版本 {job.revision} · {new Date(job.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</small><p>{job.error || job.message || job.stage}</p>{(job.status === 'running' || job.status === 'queued') && <><progress max="100" value={job.progress} /><div className="job-bottom"><span>{Math.round(job.progress)}%</span><button disabled={!!busy} onClick={() => execute('正在取消', async () => { await api(`/api/jobs/${job.id}/cancel`, { method: 'POST' }); await refreshJobData(); })}>取消任务</button></div></>}{(job.status === 'failed' || job.status === 'cancelled') && <button onClick={() => startJob(job.kind, job.sceneId)} disabled={!!busy || activeJobs.length > 0}><RefreshRounded />按当前内容重试</button>}{job.status === 'succeeded' && job.outputs && <div className="download-links">{job.outputs.video && <a href={downloadUrl(job.outputs.video)}>下载视频</a>}{job.outputs.audio && <a href={downloadUrl(job.outputs.audio)}>下载配音</a>}{job.outputs.subtitles && <a href={downloadUrl(job.outputs.subtitles)}>字幕</a>}{job.outputs.report && <a href={job.outputs.report} target="_blank" rel="noreferrer">检查报告</a>}</div>}</article>)}</div></>}
        </aside>
      </main>
      <footer className="statusbar"><span><span className={`status-dot ${busy || imageUploads > 0 || activeJob ? 'working' : ''}`} />{busy || (imageUploads > 0 ? '图片上传中，完成后可保存并应用到预览' : activeJob ? activeJob.message : '本地工作台已就绪')}</span><div>{dirty && <button onClick={() => { if (window.confirm('丢弃尚未保存的更改并重新载入？')) void loadProject(project.id); }}>放弃草稿并重新载入</button>}<span>{project.scenes.reduce((sum, scene) => sum + scene.cards.length, 0)} 张卡片</span><span>{project.sources.length} 份资料</span></div></footer>
    </>}
    {newDialog && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) setNewDialog(false); }}><section role="dialog" aria-modal="true" aria-labelledby="new-project-heading" className="modal"><div className="panel-heading"><div><h2 id="new-project-heading">创建视频项目</h2><small>每一期视频，独立保存和迭代</small></div><IconButton title="关闭新建项目" onClick={() => setNewDialog(false)} disabled={!!busy}><CloseRounded /></IconButton></div><fieldset disabled={!!busy} className="modal-fields"><Field label="项目名称"><input autoFocus value={newTitle} onChange={event => setNewTitle(event.target.value)} placeholder="例如：星穹铁道 · 第 41 周资讯" /></Field><Field label="从哪里开始"><select value={newTemplate} onChange={event => { const value = event.target.value as typeof newTemplate; setNewTemplate(value); if (value === 'starrail-weekly') setNewGame('starrail'); }}><option value="blank">空白项目</option><option value="starrail-weekly">星铁历史周报示例 · 2026.10.02</option></select></Field><Field label="游戏风格"><select value={newGame} onChange={event => setNewGame(event.target.value as Game)}>{GAMES.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><p className="help-text">创建后可导入资料、编辑分镜，或随时更换游戏风格。</p><button className="primary full-width" onClick={createProject}><Add />{busy || '创建项目'}</button></fieldset></section></div>}
  </div>;
}
