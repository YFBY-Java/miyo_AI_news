# 协作契约

项目：本地单用户视频工作台。只写本目录，原项目保持不变。已有星铁资讯是 2026-10-02 历史示例，不能标为本周最新。src/core/types.ts 是共享数据结构，协调者维护。

## HTTP

- GET `/api/projects` → `{projects: Project[], jobs: Job[], capabilities: Capability[]}`；首次初始化历史样片。
- POST `/api/projects` `{template:'starrail-weekly'|'blank'|'duplicate', title?, game?, sourceId?}` → `{project}`。
- GET `/api/projects/:id` → `ProjectResponse`。
- PUT `/api/projects/:id` `{project: Project, expectedRevision: number}` → `ProjectResponse`；冲突 409，校验 400。
- GET `/api/projects/:id/preview` → HTML，任何已保存内容都能预览；未合成时估算时间，UI 以 preview.ready 区分。
- POST `/api/projects/:id/jobs` `{kind:'prepare'|'render'|'sample', sceneId?}` → `{job}`。prepare 合成音轨与实际时间轴；render 自动 prepare 后导出；sample 只试听选定场景。
- GET `/api/jobs/:id` → `{job}`。
- POST `/api/jobs/:id/cancel` → `{job}`。
- GET `/api/media/[...path]` → data/ 内文件，支持 Range，`?download=1` 下载。
- GET `/api/assets` → `{assets: ImageAsset[]}`，当前本地素材库。
- POST `/api/assets` → multipart `file`，返回 `{asset: ImageAsset}` / 201；PNG/JPEG/静态WebP，12 MiB、3200万像素限制，原图不重编码。
- POST `/api/sources/import` `{url}` → `{source: Source}`，仅抓取公开网页，保存去标签、合并空白后的提取文本；抓取失败明确报错，用户可直接粘贴。
- POST `/api/projects/:id/compose` `{text,sourceId?,replace?:boolean}` → ProjectResponse；按段落整理为可编辑分镜，标识为草稿，无 LLM 时不声称 AI 理解或事实核对。
- 所有错误为 `{error: string}`，不暴露配置密钥。

## 画面渲染接口（渲染代理负责）

`src/engine/renderer.ts` 导出 `createVideoHtml(episode: Episode, options: {game: Game; particles:number; cardScale:number; captionSize:number; fontDataUri?:string; imageSources?:Record<string,string>}): string`。

`Card.image?` / `EpisodeScene.cards[].image?` 为 `{assetId,layout:'left'|'right'|'background',fit:'cover'|'contain',positionX:0..100,positionY:0..100}`。图片解析由 server/images 完成，只向 renderer 传入严格的 PNG/JPEG/WebP base64 data URI。ready 需等待所有图片解码，失败以 `moyo:error` 和 viewport error 状态报告。

Episode 从 `./legacy/weekly-episode` 导入。保留 `window.__weekly.seek(seconds)`、`#viewport[data-ready=true]`。接受父窗口消息 `{type:'moyo:seek',time:number}`，初始化后发送 `{type:'moyo:ready',duration:number}`；用户在画面点击时发送 `{type:'moyo:toggle'}`，点章节发送 `{type:'moyo:jump',time:number}`，防止自身独立时钟和父播放器竞争。父页面驱动 audio.currentTime + seek，导出亦走 seek。

`Card.size?` / `EpisodeScene.cards[].size?` 为 `{width:number,height:number}`，要求整数最终像素，范围宽800–1720、高360–660；缺省走 `src/core/card-layout.ts` 的不同卡位默认值，兼容历史 cardScale。Episode 卡片保留稳定 ID。仅同源父窗口可发送 `{type:'moyo:card-sizes',sizes:[{sceneId,cardId,width,height}]}` 即时改变尺寸；未知 ID 忽略，非法数值拒绝，不改变播放时间或重新解码图片。显式尺寸不再受 cardScale 缩放，保存、预览、导出一致。

场内 focusCues 的 ticket-wipe 在协调者编译时映射 classic，章节 ticket-wipe 保留。各游戏 CSS/粒子/幕切需要可区分，星铁保留当前效果。

## 通用配音脚本（配音代理负责）

`scripts/build_voice.py --input <json> --output <dir> --cache <dir>`。input 形如 `{preset:'kiana-base'|'xiaoxiao',speed:1.1,scenes:[{id,narration}],seed?:{baseAudio:string,baseEpisode:string,editorial:string}}`。

输出 `narration.wav`、`narration.m4a`、`voice-plan.json`、`voice-metadata.json`。voice-plan 为 VoicePlan（types.ts），cues 为各场景局部秒数，场景按输入顺序，无重复/空场景。scene.duration 包含首尾停顿；scenes 时长和等于 duration。可依据 seed 提取同文案既有原速音轨，保留已有字幕相对时码，再进行同样变速；不依赖原工程写路径。未命中缓存时用已有 MLX Python 环境/模型/声线，允许环境变量配置这些外部路径；xiaoxiao 可用 edge-tts。所有输出只在新工程。stdout 每个事件一行 JSON `{stage:'voice',progress:0..1,message:'...'}`。缓存指纹必须含文本/声线/模型/参考哈希/参数（speed 应在后处理层），保留输入/实际输出记录。错误 exit!=0。不安装任何工具。

## UI（界面代理负责）

仅负责 `src/ui/Studio.tsx`、`src/ui/studio.css`、`app/page.tsx`、`app/layout.tsx`。用现有 React、MUI 图标或原生控件，无新依赖。主工作台中文，暗灰背景、温暖浅白文字、少量金色强调。左分镜列表，中 16:9 同步预览，右内容编辑，底部可拖动时间轴；顶部项目切换、新建/复制/保存，主要操作合成预览/导出。资料/分镜/配音/导出可作功能区。支持编辑章节与卡片/增删/排序、口播、焦点百分比与转场、4风格、声线与1.1默认语速、资料导入/粘贴整理、任务取消和失败重试、成品下载。数据通过上述 API，持久化保存后刷新预览。iframe 通过消息驱动，音频元素是播放时间真相；无已合成音频时用估算时钟并清楚提示。所有按钮必须生效，错误和未保存状态可见。不会生成新的系统品牌宣传页。

## 协调者负责

core 模型校验、持久化、时间轴编译、后台 worker/取消恢复、全部 API、CLI、通用逐帧导出、测试与联调。data/ 存项目/任务/缓存/独立版本输出；任务输入快照不可变；同一机器一个重任务串行执行。
