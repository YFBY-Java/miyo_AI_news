# 本机运行、迁移与维护

本文依据 2026-10-06 的项目源码编写，当前项目已整理为 Windows 上的单个工程目录。日常功能操作见 [使用指南](USER_GUIDE.md)；配音实现和输入格式见 [VOICE.md](VOICE.md)，模块关系见 [ARCHITECTURE.md](ARCHITECTURE.md)。后文保留的 `/Users/shuidi/` 路径、Mac 工具版本和 Shell 示例是原机器环境记录，不能作为当前 Windows 环境已就绪的证据。原机提交与备份结果见 [版本状态](VERSION_STATE.md)。

## 1. 工程与运行边界

当前工程目录：

```text
D:\codex_work\AI创作\miyo_AI_news
```

源码、文档、字体、历史示例及 `voice-library/` 都属于这个项目根目录，Git 仓库也以此为根。默认声线目录为 `<项目根>/voice-library/琪亚娜-稳重轻角色感`，不依赖父目录资源。声线参考素材随源码提交，运行数据 `data/`、依赖、构建目录和真实 `.env` 配置继续忽略。

原机器上的 `miyo-news-card` 是渲染来源记录；当前工作台使用自己的源码、历史示例副本和 `data/`，运行时不依赖原工程。

当前是本机单用户工作台：Next.js 提供网页和 API，后台 worker 执行 Python 配音、Playwright 渲染与 FFmpeg 编码。默认只监听 `127.0.0.1:3002`，HTTP 入口也核对本机 Host 和写操作 Origin。它不是已经部署到公网的多用户服务。

项目已更名为 `miyo_AI_news`，代码中的环境变量仍沿用 `MOYO_*`。不要自行替换成 `MIYO_*`，当前源码不读取后者。

## 2. 已有依赖与检查

以下是原 Mac 机器已核验的位置或版本，保留用于定位历史执行记录；它们不是当前 Windows 环境检查结果，也不是全部写入 Git 的可移植依赖。

| 组件 | 本机情况 | 用途 |
|---|---|---|
| Node.js / npm | `v24.16.0` / `11.13.0`；位于 `~/.local/share/mise/installs/node/24.16.0/bin/` | 网页、worker、TypeScript 脚本 |
| Python 控制器 | `python3` 为 3.13.15，命令位于 `~/.local/bin/python3` | 配音编排、缓存和 FFmpeg 处理 |
| Next.js / React | 当前安装 15.5.12 / 19.2.3 | 工作台界面及 API |
| TypeScript / tsx | 当前安装 5.8.3 / 4.21.0 | 类型检查和运行 worker 源码 |
| Playwright | 当前项目安装 1.57.0 | 逐帧渲染 |
| sharp | 当前项目安装 0.34.5 | 配图格式、尺寸和解码校验 |
| FFmpeg / FFprobe | `~/.homebrew/bin/ffmpeg`、`~/.homebrew/bin/ffprobe` | 音频处理、视频编码与校验 |
| edge-tts | `~/.local/bin/edge-tts` | 晓晓在线语音合成 |
| MLX Python | 见下方声线配置表 | 琪亚娜本地合成；与普通 `python3` 分开 |

项目声明 Node.js 至少为 20。迁移时以 `package-lock.json` 恢复相应依赖，不要仅复制 `.next-build/`：后台仍会运行 `scripts/*.ts`，需要 `tsx`、源码、字体和 fixtures。直接省略所有开发依赖会漏掉当前 worker 使用的 `tsx`。

在项目根目录执行以下只读检查：

```bash
cd '/Users/shuidi/Documents/ChatGPT/AI创作/miyo_AI_news'
node --version
npm --version
python3 --version
command -v node npm python3 ffmpeg ffprobe edge-tts
```

本机有可用的 Playwright 无头浏览器：

```text
/Users/shuidi/Library/Caches/ms-playwright/chromium_headless_shell-1200/chrome-headless-shell-mac-arm64/chrome-headless-shell
```

`chromium.executablePath()` 返回的是完整 Chromium 默认位置，本机该完整浏览器路径目前不存在；这不代表 `chromium.launch({headless:true})` 所需的 headless shell 缺失。需要验证实际渲染能力时，可运行下面的小型启动检查。它只启动并关闭无头浏览器，不访问网站，也不是 Codex 内置浏览器：

```bash
node --input-type=module <<'JS'
import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
try {
  console.log('无头浏览器可用：', browser.version());
} finally {
  await browser.close();
}
JS
```

本机已有依赖时直接使用。遇到缺失先确认 PATH、目录和已有运行环境，勿为了排查重复安装整套依赖。本工程没有 Docker 前置条件。

## 3. 开发模式启动

当前 Windows 目录在 PowerShell 中启动：

```powershell
Set-Location 'D:\codex_work\AI创作\miyo_AI_news'
npm run dev
```

原 Mac 机器的启动示例：

```bash
cd '/Users/shuidi/Documents/ChatGPT/AI创作/miyo_AI_news'
npm run dev
```

然后在自己使用的浏览器访问：

```text
http://127.0.0.1:3002
```

终端需要保持运行。端口被占用时，先确认是否已经启动过工作台；不要直接终止所有 Node 或 Python 进程。

另开终端可检查服务：

```bash
curl -fsS http://127.0.0.1:3002/api/health
```

首次访问会初始化默认数据目录并导入星铁历史样例，材料日期为 **2026-10-02**。这一步会创建项目、归档配音和时间轴，不会自动采集最新资讯，也不会立即生成新 TTS。网页“本地工具状态”是路径/命令层面的初步检查，不代替真实试听、浏览器启动和导出验证。

### 任务和网页进程的区别

- 点击合成或导出后，API 创建任务快照并自动启动 worker，日常不需要手动运行 `npm run worker`。
- worker 是独立后台进程。关闭页面、退出 CLI 或在网页终端按 `Ctrl+C`，不等于取消已启动任务。
- 需要取消时，在任务记录中点击“取消任务”，等状态变成 `cancelled`。
- 同一数据目录使用一个 worker 锁，重任务按队列串行处理。worker 空闲约 2 秒后退出，不是开机常驻服务。
- 改环境变量前，先让旧任务和 worker 结束，再重新启动网页或 CLI；已有 worker 保留启动时继承的环境。

## 4. 生产构建与启动

默认 `npm run build` 和 `npm run start` 都使用 `.next/`。若同时保留开发目录和生产构建，可按当前配置使用独立的 `.next-build/`：

```bash
cd '/Users/shuidi/Documents/ChatGPT/AI创作/miyo_AI_news'
MOYO_NEXT_DIST_DIR=.next-build npm run build
```

构建成功后，先结束占用 3002 端口的开发服务，再使用同一个目录名启动：

```bash
MOYO_NEXT_DIST_DIR=.next-build npm run start
```

生产启动确实支持此环境变量：`next.config.ts` 用它设置 `distDir`，当前安装的 Next.js 在生产启动时仍会加载该配置。只在 build 时设置、start 时省略，会让启动端到默认 `.next/` 查找产物，导致使用错误构建或提示没有生产构建。

生产网页仍监听 `127.0.0.1:3002`，不会自动开放公网。`.next/`、`.next-build/` 均属于可重新生成的构建结果，不是项目内容备份。

运行时仍需保留：

```text
app/、src/、scripts/
package.json、package-lock.json、next.config.ts、node_modules/
public/assets/htmlFont.ttf
fixtures/starrail-weekly/
voice-library/琪亚娜-稳重轻角色感/
data/（或 MOYO_DATA_DIR 指定的位置）
```

声线参考素材位于项目内，并随 Git 恢复；模型、推理环境和 Playwright 浏览器仍是机器依赖。生产构建不会把这些资源打进 `.next-build/`，运行时应保留项目内的声线目录。

## 5. CLI 的真实用法

CLI 直接读写本地数据、创建 worker 任务，不依赖网页服务器已经启动，但应在工程根目录执行并使用与网页相同的数据和声线环境。

### 列出项目

```bash
npm run render
```

未提供参数时会输出用法和项目 ID/名称；这条命令也会调用首次初始化。因此，在一个全新的数据目录运行它并非完全只读。

### 仅合成配音与同步预览

```bash
npm run render -- starrail-demo prepare
```

输出配音、实际时间轴、字幕和 HTML，完成后打印任务 JSON，不渲染 MP4。示例中的 `starrail-demo` 可以替换为列表中自己的项目 ID。

### 导出完整视频

```bash
npm run render -- starrail-demo render
```

也可省略最后的 `render`：

```bash
npm run render -- starrail-demo
```

CLI 会轮询任务进度直到成功、失败或取消。失败/取消时退出码为非零。按 `Ctrl+C` 只结束等待界面，已启动的独立 worker 仍可能运行；应回工作台取消对应任务。

当前参数解析只有两种任务：第三个参数**恰好等于 `prepare`** 才选择配音准备，其他值都按 `render` 处理。不要使用 `sample`、`cancel`、`--help` 或猜测参数来试探：它们不是现有 CLI 子命令。分镜试听与取消通过网页完成。

### 手动启动队列处理器

```bash
npm run worker
```

适用于已经初始化的数据目录中有排队任务、需要检查 worker 的场景。没有队列时它很快退出；已有 worker 持锁时，新进程不会另开一套并行渲染。正常情况下，网页和 CLI 已负责启动它。

## 6. 路径与环境变量

建议按一次启动或当前终端设置变量，不需要改全局 Shell 配置。涉及目录时使用绝对路径，避免网页、worker 和 CLI 对相对路径产生不同理解。

| 变量 | 当前默认和作用 |
|---|---|
| `MOYO_ROOT` | 默认 `process.cwd()`；Node 服务端和 worker 的工程根目录，负责定位 scripts、fixtures、字体。通常先 `cd` 到工程即可，无须额外设置 |
| `MOYO_DATA_DIR` | 默认 `<MOYO_ROOT>/data`；项目、任务、图片、音轨缓存和输出的根目录 |
| `MOYO_NEXT_DIST_DIR` | 默认 `.next`；开发/生产 Next 构建目录，可用 `.next-build` |
| `MOYO_PYTHON` | worker 启动配音控制器时使用，默认 `python3`；控制器自身仅依赖标准库 |
| `MOYO_MLX_PYTHON` | `/Users/shuidi/Documents/Codex/2026-09-25/ruh/work/jev-video/.venv_mlx_audio/bin/python`；新琪亚娜口播使用的独立 MLX 解释器 |
| `MOYO_KIANA_VOICE_DIR` | 默认 `<MOYO_ROOT>/voice-library/琪亚娜-稳重轻角色感`，随项目提交 |
| `MOYO_KIANA_MODEL` | `~/.cache/huggingface/hub/models--mlx-community--Qwen3-TTS-12Hz-1.7B-Base-4bit/snapshots/37e955a1deb861c088ae5f3a67043185f3d1a60c` |
| `MOYO_KIANA_REFERENCE` | 声线目录下 `kiana_refs_concat_v2_light.wav` |
| `MOYO_KIANA_REFERENCE_TEXT` | 声线目录下 `reference_audio_v2_light/ref_text.txt` |
| `MOYO_KIANA_PRESETS` | 声线目录下 `test/qwen17b-v2-light-versions/variants.json`，读取 `base` 预设 |
| `MOYO_FFMPEG`、`MOYO_FFPROBE` | 仅 Python 配音流水线的工具路径覆盖 |
| `MOYO_EDGE_TTS` | 仅 Python 配音流水线的 edge-tts 路径覆盖 |

### FFmpeg 路径覆盖的实际边界

`scripts/render-video.ts` 直接执行 PATH 上的 `ffmpeg`、`ffprobe`。网页能力检测也直接执行 PATH 上的工具。因此，设置 `MOYO_FFMPEG` 不能单独修复视频阶段的 `ffmpeg ENOENT`。

本机若从一个缺少用户 PATH 的终端启动，可为该次启动补上已有工具目录：

```bash
PATH="$HOME/.homebrew/bin:$HOME/.local/bin:$PATH" npm run dev
```

这不修改全局配置。新 worker 继承发起进程的环境；已在运行的 worker 不会因此改变。

### 声线覆盖与历史素材

显式设置任意一项 `MOYO_MLX_PYTHON`、`MOYO_KIANA_MODEL`、`MOYO_KIANA_VOICE_DIR`、`MOYO_KIANA_REFERENCE`、`MOYO_KIANA_REFERENCE_TEXT`、`MOYO_KIANA_PRESETS`，会保守禁用归档原速 seed 的复用，即使变量指向原默认位置。之后按实际配置计算缓存指纹，命中可验证缓存则复用，否则生成新语音。首次初始化也不会把旧基准音轨冒充自定义声线。

整期复用还会核对声线环境身份和 WAV 哈希。变更图片、布局和卡片尺寸通常复用已有配音；变更口播、分镜 ID/顺序、语速或声线会重新准备实际时间轴。

琪亚娜生成使用本地模型，设置离线模式，不会自动下载缺少的模型。晓晓通过 edge-tts 在线合成，需要网络。当前项目不会在失败时自动切到 `say` 或另一条声线。

`.env`、`.env.*` 不进入 Git。Next.js 有自己的环境文件加载机制，但独立 CLI/worker/Python 没有统一显式加载 `.env` 的入口；需要跨入口一致时，使用启动进程实际继承的 Shell 环境，不要仅因文件存在就认为 CLI 已应用。

## 7. 首次迁移与运行前核对

复制工程或从代码恢复时，按以下顺序检查：

1. **确认工程位置。** 新工作目录应是 `miyo_AI_news`，不是原项目 `miyo-news-card`；`MOYO_ROOT` 若还指向旧位置，应在启动前修正或取消该覆盖。
2. **保留源码与锁定依赖。** 网页构建结果不包括 worker 所需的全部 TypeScript 文件；保留 `tsx`，不要把生产运行简化为仅保留 Next 构建目录。
3. **核对附带资源。** 检查字体、`fixtures/starrail-weekly/base-narration.wav`、`final-narration.wav` 及其 JSON 元数据，并保留项目内 `voice-library/` 的参考音频、参考文本和参数 3 个文件，避免只复制文字文件。
4. **选择正确的数据恢复方式。** 有备份时应在首次启动前放好恢复数据或指定 `MOYO_DATA_DIR`；空数据目录会新建示例，不会自动找到别处的旧项目。
5. **核对模型与推理环境。** 声线参考目录已在应用 Git 内，默认无须覆盖路径；模型快照和 MLX Python 仍需在目标机器准备，不能把旧解释器的绝对路径当作已恢复的 Python 环境。
6. **核对浏览器与编码工具。** 图片预览正常不代表 Playwright headless shell 和视频阶段的 FFmpeg 已就绪。
7. **确认旧任务静止。** 移动或改名工程前先完成/取消任务，等待 worker 退出；运行中的进程已经持有旧路径，不会随文件夹改名自动迁移。
8. **先做小规模验证。** 使用历史样例副本保留一个分镜，先试听，再导出一段；验证通过后再制作整期。不要覆盖原始示例来做环境探测。

项目代码里仍可能保留历史生成记录的绝对路径，这些记录用于追溯，不代表迁移后所有旧路径都可直接访问。项目和任务的 ID、图片 UUID 目录应保持原样。

## 8. 数据内容与备份

`.gitignore` 明确排除 `data/`。**提交代码不会备份项目、原图、声线结果和视频；回退代码也不会回退这些数据。**

| 位置 | 保存内容 | 备份意义 |
|---|---|---|
| `data/projects/*.json` | 可编辑项目、资料、口播、图片引用、卡片尺寸、revision | 编辑状态 |
| `data/assets/<UUID>/` | 上传原图、格式/尺寸元数据与 SHA-256 | 项目图片依赖；不要按原文件名随意合并 |
| `data/jobs/*.json` | 队列、进度、终态、输出引用 | 任务历史 |
| `data/runs/<任务ID>/` | 任务项目快照、配音、字幕、时间轴、HTML、视频和报告 | 每次独立成片与制作证据 |
| `data/cache/voice/` | 可验证原速音轨缓存 | 降低重试/变速时的生成成本 |
| `data/logs/` | worker 汇总日志 | 故障定位 |
| `data/verification/` | 调试或回归验证证据 | 可追溯的验证材料 |

### 先让任务静止

完整备份应在任务静止后执行：先等所有排队/运行任务完成，或在界面取消并等待终态；再结束网页服务，确认 worker 和该工程的渲染子进程退出。只关闭浏览器标签页不够。

下列命令只检查任务 JSON 是否仍有活动状态。若使用自定义 `MOYO_DATA_DIR`，在同样的环境下执行：

```bash
python3 - <<'PY'
import json, os
from pathlib import Path
miyo_data = Path(os.environ.get('MOYO_DATA_DIR', 'data')).expanduser().resolve()
miyo_active = []
for file in (miyo_data / 'jobs').glob('*.json'):
    job = json.loads(file.read_text())
    if job.get('status') in ('queued', 'running'):
        miyo_active.append({'id': job['id'], 'status': job['status'], 'stage': job.get('stage')})
print(json.dumps({'data': str(miyo_data), 'activeJobs': miyo_active}, ensure_ascii=False, indent=2))
raise SystemExit(1 if miyo_active else 0)
PY
```

此检查不能独立证明操作系统没有遗留进程。仍需确认 `data/worker.lock` 对应进程已结束；有异常中断时先按后文定位，不要边渲染边打包，也不要直接删活跃锁。

### 完整目录备份示例

下面示例适用于默认 `data/`，在已确认静止后执行。每次创建独立目录，避免覆盖旧备份：

```bash
cd '/Users/shuidi/Documents/ChatGPT/AI创作/miyo_AI_news'
mkdir -p backups
miyo_backup_dir="backups/$(date +%Y%m%d-%H%M%S)"
mkdir "$miyo_backup_dir"
tar -czf "$miyo_backup_dir/data.tar.gz" -C "$PWD" data
shasum -a 256 "$miyo_backup_dir/data.tar.gz" > "$miyo_backup_dir/data.tar.gz.sha256"
DEVELOPER_DIR=/Library/Developer/CommandLineTools git rev-parse HEAD > "$miyo_backup_dir/code-commit.txt"
```

`backups/` 已被 Git 忽略。最后一条命令仅为本次 Git 调用指定本机已有 Command Line Tools，避开当前默认 Xcode 的许可提示，不修改系统设置；其他机器使用其正常可用的 Git 即可。

自定义数据目录时，要备份那个真实目录，而不是默认的空 `data/`。记录该备份使用的代码提交、数据路径、声线环境变量名称及非敏感路径；不要把密钥或整份进程环境无差别写进清单。

如需搬到另一台机器，先从同一个仓库恢复源码、字体、fixtures 和 `voice-library/`，再恢复制作数据并准备所需模型与工具。声线参考目录已经随工程提交，无须在工程旁边另外放一份。虚拟环境和 Node 原生模块需要与目标机器匹配；把整个旧虚拟环境复制过去不保证可运行。

### 恢复时不要直接合并覆盖

1. 停止当前项目任务和服务，先备份当前数据。
2. 将备份解压到一个**新的恢复目录**，保留原数据作为回退。
3. 校验归档 SHA-256，核对项目、图片和 runs 目录齐全。
4. 以绝对路径将 `MOYO_DATA_DIR` 指向恢复出的 `data`，并使用匹配的代码版本与声线环境启动。
5. 打开原有项目，核对卡片、配图和旧成片；再复制一个项目做短导出验证。

例如，假设已将归档解压到同级 `miyo_AI_news-restored/`：

```bash
MOYO_DATA_DIR='/Users/shuidi/Documents/ChatGPT/AI创作/miyo_AI_news-restored/data' npm run dev
```

使用恢复目录运行 CLI 时也要传同样的变量。不要一边网页用恢复目录，一边 CLI 仍写默认目录。

当前没有面向跨版本数据的自动迁移/回退命令。较旧代码可能不认识后续新增字段；不要让旧代码直接保存唯一一份新数据。代码版本回退、数据恢复和视频产物选择应分别处理。

## 9. 故障定位

优先按任务 ID 检查该次输入和日志，避免拿另一版本的画面或音频判断本次任务。

| 现象 | 先看哪里 | 建议处理 |
|---|---|---|
| 网页打不开或端口占用 | 启动终端、3002 监听状态 | 确认当前启动的是开发还是生产服务，避免重复占用 |
| 生产提示找不到构建 | build/start 的 `MOYO_NEXT_DIST_DIR` 是否一致 | 用相同目录完成构建和启动 |
| 项目列表突然只有示例 | 当前 `MOYO_DATA_DIR`、`data/initialized.json` | 核对是否启动到了新的数据目录，不要立即覆盖现有项目 |
| 保存提示版本冲突 | 项目 revision，其他打开窗口 | 保留当前未保存内容，刷新核对后再保存 |
| 配音失败 | `runs/<ID>/voice.log`、`execution-records.jsonl`、`work/` 下生成日志 | 检查实际解释器、参考音频/文本、模型及该段输入 |
| 页面显示声线可用但新口播失败 | 配音详细日志 | 路径存在不保证依赖齐全或新参考有效，先试听单段 |
| 晓晓生成失败 | `generation.log`、网络 | 该声线是在线路径；不会自动换声线 |
| 旧配音没有复用 | `audio-provenance.json`、`voice-metadata.json`、任务 voiceIdentity | 核对是否改了语速/口播/分镜顺序或设置了显式声线覆盖 |
| 渲染报 `ffmpeg` / `ffprobe` 不存在 | `render.log`、启动进程 PATH | 视频阶段使用 PATH，不读取 Python 的工具覆盖变量 |
| 浏览器可执行文件缺失 | `render.log`、Playwright headless shell | 区分完整 Chromium 和实际 headless shell；缺失时单独处理环境，不盲目重复安装 |
| 配图缺失或哈希不符 | `assets/<UUID>/metadata.json`、原图文件、项目引用 | 恢复配套原图，或重新上传产生新资产后重新关联；不要手改旧图伪装成同一个资产 |
| 卡片正文溢出 | `render.log`、当前卡片尺寸/配图布局、预览 | 增大卡片、换用合适的配图布局或拆分文案后重试 |
| 视频失败但配音已完成 | `audio-ready.json`、`voice-plan.json` | 按当前内容重试，已验证配音可复用，视频会重新逐帧渲染 |
| 存在 `video.partial.mp4` | 同任务状态、`render.log` | 这是未发布结果，不能手工改名当作成功成片 |
| 任务持续排队 | `logs/worker.log`、worker 锁、任务 JSON | 查询任务/刷新项目会尝试启动 worker；必要时在同环境执行 `npm run worker` |
| 程序中断后显示失败 | `stage: interrupted`、任务快照 | 恢复逻辑会标记中断，不自动续接部分视频；核对后重试 |

完整导出成功通常有以下证据组合：任务 `status=succeeded`、`outputs.video`、`runs/<ID>/video.mp4` 和 `render-report.json`。报告包含画面错误/溢出检查、编码参数及完整解码结果；它不代表资讯事实或配音逐字正确，内容和听感仍要检查。

直接查看任务日志的例子：

```bash
cat 'data/jobs/实际任务ID.json'
tail -n 80 'data/runs/实际任务ID/voice.log'
tail -n 80 'data/runs/实际任务ID/render.log'
tail -n 80 'data/logs/worker.log'
```

发生中断时，不使用 `pkill node`、`pkill python` 或删除全部锁的方式恢复。worker 已记录任务所属进程组，并对 Chromium 加了独立任务路径标记；下一次恢复会核对身份后清理属于该任务的遗留进程。手工操作前也应先确认 PID、命令行和任务目录相符。

## 10. 维护时的验证范围

常规代码检查：

全新代码副本如果尚未生成 Next 类型文件，先运行一次开发服务或生产构建，再执行类型检查。

```bash
npm run typecheck
npm test
```

需要验证配音缓存和语速编排时：

```bash
python3 tests/voice_pipeline_test.py
```

Python 回归使用归档配音和负例，不进行新 MLX 推理或在线 TTS；它会在 `data/verification/voice-tests-*` 留下新的执行记录。Node 的存储/图片专项测试使用独立临时数据，具体以各测试文件为准。

生产构建检查与实际短片导出验证是不同环节：构建通过只能说明网页代码可构建，实际导出还依赖声线、浏览器、FFmpeg、配图和内容布局。应根据本次改动选择对应检查，避免每次文档修改都重新生成整期配音和视频。
