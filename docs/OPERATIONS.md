# 本机运行、迁移与维护

本文依据 2026-10-06 的跨平台项目源码编写，适用于 macOS 终端与 Windows PowerShell。日常功能操作见 [使用指南](USER_GUIDE.md)；配音实现和输入格式见 [VOICE.md](VOICE.md)，模块关系见 [ARCHITECTURE.md](ARCHITECTURE.md)。原 Mac 交付环境的验收与备份作为历史证据保留在 [验收记录](VERIFICATION.md) 和 [版本状态](VERSION_STATE.md)。

## 1. 工程与运行边界

项目使用单个无版本号目录，可以放在任意工作位置：

```text
miyo_AI_news/
├── app/、src/、scripts/、tests/
├── public/、fixtures/、voice-library/
├── .env.example、package.json、package-lock.json
└── data/
```

源码、文档、字体、历史示例及 `voice-library/` 都属于这个项目根目录，Git 仓库也以此为根。默认声线目录为 `<项目根>/voice-library/琪亚娜-稳重轻角色感`，不依赖父目录资源。声线参考素材随源码提交，运行数据 `data/`、依赖、构建目录和真实 `.env` 配置继续忽略。

原机器上的 `miyo-news-card` 是渲染来源记录；当前工作台使用自己的源码、历史示例副本和 `data/`，运行时不依赖原工程。

当前是本机单用户工作台：Next.js 提供网页和 API，后台 worker 执行 Python 配音、Playwright 渲染与 FFmpeg 编码。默认只监听 `127.0.0.1:3002`，HTTP 入口也核对本机 Host 和写操作 Origin。它不是已经部署到公网的多用户服务。

项目已更名为 `miyo_AI_news`，代码中的环境变量仍沿用 `MOYO_*`。不要自行替换成 `MIYO_*`，当前源码不读取后者。

## 2. 依赖与平台范围

按功能准备依赖，已有工具可通过 PATH 或项目配置复用。

| 组件 | 要求 | 用途 |
|---|---|---|
| Node.js / npm | Node 20 以上；CI 使用 Node 20 | 网页、worker、TypeScript 脚本 |
| Python 控制器 | Python 3.10 以上；CI 使用 3.11，控制器只依赖标准库 | 配音编排、缓存和 FFmpeg 处理 |
| 项目 JavaScript 依赖 | `npm ci` 按 `package-lock.json` 安装 | Next、React、tsx、Playwright、sharp 等 |
| Playwright Chromium | `npx playwright install chromium` | 真实浏览器测试与逐帧渲染 |
| FFmpeg / FFprobe | 同一发行包的两个可执行文件 | 音频处理、视频编码与校验 |
| edge-tts | 可执行工具，合成时需要网络 | 新晓晓口播 |
| MLX Python / Qwen3-TTS 模型 | Apple Silicon Mac 上单独准备 `.venv-mlx/` 与完整模型 | 新琪亚娜口播 |

项目声明 Node.js 至少为 20。迁移时以 `package-lock.json` 恢复相应依赖，不要仅复制 `.next-build/`：后台仍会运行 `scripts/*.ts`，需要 `tsx`、源码、字体和 fixtures。直接省略所有开发依赖会漏掉当前 worker 使用的 `tsx`。

Windows、Intel Mac 和 Apple Silicon Mac 都可以编辑项目、复用匹配的历史琪亚娜音轨、使用晓晓及导出视频。**新琪亚娜口播仅走 Apple Silicon Mac 的 MLX 路径**；在其他平台明确报错，程序不会自动换声线。历史素材复用无需安装 MLX，但需要 Python 与 FFmpeg/FFprobe。

在项目根目录安装项目依赖与浏览器：

```bash
npm ci
npx playwright install chromium
```

已有 FFmpeg 可在 `.env.local` 指定路径。若目标机器尚未准备工具，macOS 使用已有 Homebrew 安装：

```sh
brew install ffmpeg
```

Windows 可使用已有 Chocolatey 安装同一发行包，然后在新终端中检查：

```powershell
choco install ffmpeg --yes --no-progress
ffmpeg -version
ffprobe -version
```

这些安装命令需要相应包管理器已安装；也可准备工具原生可执行文件后配置 `MOYO_FFMPEG`、`MOYO_FFPROBE`。Windows 覆盖值应指向 `.exe`，不使用 `.cmd`/`.bat` 包装器。工具状态只是初步探测，真实准备、浏览器绘制和编码使用 `npm run check:runtime` 检查。本工程没有 Docker 前置条件。

## 3. 开发模式启动

进入项目根目录后，两系统使用相同命令：

```sh
npm run dev
```

然后在自己使用的浏览器访问：

```text
http://127.0.0.1:3002
```

终端需要保持运行。端口被占用时，先确认是否已经启动过工作台；不要直接终止所有 Node 或 Python 进程。

另开终端可检查服务：

```sh
node -e "fetch('http://127.0.0.1:3002/api/health').then(r => r.json()).then(console.log)"
```

首次访问会初始化默认数据目录并导入星铁历史样例，材料日期为 **2026-10-02**。这一步会创建项目、归档配音和时间轴，不会自动采集最新资讯，也不会立即生成新 TTS。网页“本地工具状态”是路径/命令层面的初步检查，不代替真实试听、浏览器启动和导出验证。

### 任务和网页进程的区别

- 点击合成或导出后，API 创建任务快照并自动启动 worker，日常不需要手动运行 `npm run worker`。
- worker 是独立后台进程。关闭页面、退出 CLI 或在网页终端按 `Ctrl+C`，不等于取消已启动任务。
- 需要取消时，在任务记录中点击“取消任务”，等状态变成 `cancelled`。
- 同一数据目录使用一个 worker 锁，重任务按队列串行处理。worker 空闲约 2 秒后退出，不是开机常驻服务。
- 改环境变量前，先让旧任务和 worker 结束，再重新启动网页或 CLI；已有 worker 保留启动时继承的环境。

## 4. 生产构建与启动

默认 `npm run build` 和 `npm run start` 都使用 `.next/`。从项目根运行：

```sh
npm run build
npm start
```

若需要独立 `.next-build/` 目录，macOS 可在同一终端设置：

```sh
export MOYO_NEXT_DIST_DIR=.next-build
npm run build
npm start
```

Windows PowerShell 对应为：

```powershell
$env:MOYO_NEXT_DIST_DIR = '.next-build'
npm run build
npm start
```

也可把 `MOYO_NEXT_DIST_DIR=.next-build` 写入项目 `.env.local`。构建成功后先结束占用 3002 的开发服务，再启动生产服务。`next.config.ts` 用该变量设置 `distDir`；build 和 start 必须一致，否则会到另一个目录查找产物。

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

本机配置放在项目 `.env.local`；提交空配置结构 `.env.example`，不要提交真实环境文件。网页、CLI、worker 和 Python 从项目根依次加载 `.env.local`、`.env`，已经存在的外部环境变量优先，其次为 `.env.local`，最后为 `.env`。修改后重新启动服务并等待旧 worker 退出。

资源路径相对于同一项目根解析，可写 `./data`、`./tools/ffmpeg/bin/ffmpeg.exe` 等，网页和后台使用一致路径。`~/` 可指向当前用户主目录；配置使用字面值，不写 Shell 命令或 `$HOME` 等展开表达式。日常从项目根执行 npm 命令即可，无须设置 `MOYO_ROOT`。

| 变量 | 当前默认和作用 |
|---|---|
| `MOYO_ROOT` | 默认 `process.cwd()`；Node 服务端和 worker 的工程根目录，负责定位 scripts、fixtures、字体。通常先 `cd` 到工程即可，无须额外设置 |
| `MOYO_DATA_DIR` | 默认 `<MOYO_ROOT>/data`；项目、任务、图片、音轨缓存和输出的根目录 |
| `MOYO_NEXT_DIST_DIR` | 默认 `.next`；开发/生产 Next 构建目录，可用 `.next-build` |
| `MOYO_PYTHON` | Python 3.10 以上；未覆盖时先找项目 `.venv`，Windows 再尝试 `py -3`，然后 `python3` / `python`；每个候选实际启动验证 |
| `MOYO_MLX_PYTHON` | macOS 为 `<项目根>/.venv-mlx/bin/python`；Windows 路径结构为 `.venv-mlx/Scripts/python.exe`，但不启用新 MLX 推理 |
| `MOYO_KIANA_VOICE_DIR` | 默认 `<MOYO_ROOT>/voice-library/琪亚娜-稳重轻角色感`，随项目提交 |
| `MOYO_KIANA_MODEL` | `<项目根>/models/Qwen3-TTS-12Hz-1.7B-Base-4bit`；完整离线模型，需自行准备 |
| `MOYO_KIANA_REFERENCE` | 声线目录下 `kiana_refs_concat_v2_light.wav` |
| `MOYO_KIANA_REFERENCE_TEXT` | 声线目录下 `reference_audio_v2_light/ref_text.txt` |
| `MOYO_KIANA_PRESETS` | 声线目录下 `test/qwen17b-v2-light-versions/variants.json`，读取 `base` 预设 |
| `MOYO_FFMPEG`、`MOYO_FFPROBE` | 配音、渲染、媒体检查与工具状态共用的可执行文件覆盖 |
| `MOYO_EDGE_TTS` | 晓晓工具覆盖；未覆盖时找项目 `.venv`、PATH 和 macOS 常见工具目录 |
| `MOYO_CHROMIUM` | 可选的实际浏览器可执行文件路径；默认使用当前项目 Playwright 安装的 Chromium |

### 工具探测与覆盖

FFmpeg、FFprobe、edge-tts 先读取各自 `MOYO_*` 覆盖，再查项目 `.venv/Scripts`（Windows）或 `.venv/bin`（macOS）、PATH；macOS 最后检查 `/opt/homebrew/bin`、`/usr/local/bin`、用户 `.homebrew/bin`、`.local/bin`。覆盖无效时明确报错，不静默切换到另一份工具。FFprobe 没有单独覆盖时，优先寻找当前 FFmpeg 同目录的 FFprobe，再按上述目录查找。

例如 Windows 将工具放入项目 `tools/ffmpeg/bin/` 后，在 `.env.local` 写：

```dotenv
MOYO_FFMPEG=./tools/ffmpeg/bin/ffmpeg.exe
MOYO_FFPROBE=./tools/ffmpeg/bin/ffprobe.exe
```

macOS 指向实际无 `.exe` 后缀的文件即可。工具和虚拟环境不是源码资源，需在目标机器重新准备，不复制另一系统的可执行文件。`MOYO_CHROMIUM` 覆盖也必须指向真实浏览器文件；浏览器测试仍使用项目安装的 Chromium。

### 声线覆盖与历史素材

显式设置任意一项 `MOYO_MLX_PYTHON`、`MOYO_KIANA_MODEL`、`MOYO_KIANA_VOICE_DIR`、`MOYO_KIANA_REFERENCE`、`MOYO_KIANA_REFERENCE_TEXT`、`MOYO_KIANA_PRESETS`，会保守禁用归档原速 seed 的复用，即使变量指向原默认位置。之后按实际配置计算缓存指纹，命中可验证缓存则复用，否则生成新语音。首次初始化也不会把旧基准音轨冒充自定义声线。

整期复用还会核对声线环境身份和 WAV 哈希。变更图片、布局和卡片尺寸通常复用已有配音；变更口播、分镜 ID/顺序、语速或声线会重新准备实际时间轴。

新琪亚娜生成要求 Apple Silicon Mac，使用本地模型和离线模式，不会自动下载缺少的模型。Windows 与 Intel Mac 可以复用匹配的归档琪亚娜音轨，或手动选择晓晓在线合成。当前项目不会在失败时自动切到 `say` 或另一条声线。

Windows 的 Python 控制器和任务子进程使用 UTF-8 并隐藏额外窗口；取消/恢复按 PID、进程创建时间和任务目录核对身份后通过 `taskkill /T` 清理任务树。macOS 使用任务进程组信号。

## 7. 首次迁移与运行前核对

复制工程或从代码恢复时，按以下顺序检查：

1. **确认工程位置。** 新工作目录应是 `miyo_AI_news`，不是原项目 `miyo-news-card`；`MOYO_ROOT` 若还指向旧位置，应在启动前修正或取消该覆盖。
2. **保留源码与锁定依赖。** 网页构建结果不包括 worker 所需的全部 TypeScript 文件；保留 `tsx`，不要把生产运行简化为仅保留 Next 构建目录。
3. **核对附带资源。** 检查字体、`fixtures/starrail-weekly/base-narration.wav`、`final-narration.wav` 及其 JSON 元数据，并保留项目内 `voice-library/` 的参考音频、参考文本和参数 3 个文件，避免只复制文字文件。
4. **选择正确的数据恢复方式。** 有备份时应在首次启动前放好恢复数据或指定 `MOYO_DATA_DIR`；空数据目录会新建示例，不会自动找到别处的旧项目。
5. **选择平台可用的声线。** 历史原稿可复用归档音轨；新晓晓需 edge-tts 与网络；新琪亚娜仅 Apple Silicon Mac，需 `.venv-mlx` 与完整模型。声线目录已随 Git 恢复，无须仅为迁移设置覆盖。
6. **核对浏览器与编码工具。** 安装项目对应的 Chromium，确认 Python 3.10 以上、FFmpeg/FFprobe 可执行；视频阶段和配音阶段使用相同工具配置。
7. **确认旧任务静止。** 移动或改名工程前先完成/取消任务，等待 worker 退出；运行中的进程已经持有旧路径，不会随文件夹改名自动迁移。
8. **先做小规模验证。** 运行 `npm run check:runtime` 在隔离工程中实际准备配音、短片渲染、取消与复用；确认成功后再复制用户项目做试听和制作。

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

```sh
node --import tsx --input-type=module -e "import { DATA, listJobs } from './src/server/storage.ts'; const active = (await listJobs()).filter(j => ['queued', 'running'].includes(j.status)); console.log(JSON.stringify({data: DATA, activeJobs: active.map(j => ({id:j.id,status:j.status,stage:j.stage}))}, null, 2)); process.exitCode = active.length ? 1 : 0;"
```

此检查不能独立证明操作系统没有遗留进程。仍需确认 `data/worker.lock` 对应进程已结束；有异常中断时先按后文定位，不要边渲染边打包，也不要直接删活跃锁。

### 完整目录备份示例

下面示例适用于默认 `data/`，在已确认静止后执行。每次创建独立目录，避免覆盖旧备份：

macOS 终端：

```sh
mkdir -p backups
miyo_backup_dir="backups/$(date +%Y%m%d-%H%M%S)"
mkdir "$miyo_backup_dir"
tar -czf "$miyo_backup_dir/data.tar.gz" -C "$PWD" data
shasum -a 256 "$miyo_backup_dir/data.tar.gz" > "$miyo_backup_dir/data.tar.gz.sha256"
git rev-parse HEAD > "$miyo_backup_dir/code-commit.txt"
```

Windows PowerShell：

```powershell
$miyoBackupDir = Join-Path 'backups' (Get-Date -Format 'yyyyMMdd-HHmmss')
New-Item -ItemType Directory -Path $miyoBackupDir | Out-Null
tar -czf "$miyoBackupDir/data.tar.gz" data
if ($LASTEXITCODE -ne 0) { throw '数据归档失败' }
Get-FileHash "$miyoBackupDir/data.tar.gz" -Algorithm SHA256 | Format-List | Out-File "$miyoBackupDir/data.tar.gz.sha256" -Encoding utf8
git rev-parse HEAD | Out-File "$miyoBackupDir/code-commit.txt" -Encoding utf8
```

`backups/` 已被 Git 忽略。归档结束后核对文件大小和校验值，保留对应代码提交。

自定义数据目录时，要备份那个真实目录，而不是默认的空 `data/`。记录该备份使用的代码提交、数据路径、声线环境变量名称及非敏感路径；不要把密钥或整份进程环境无差别写进清单。

如需搬到另一台机器，先从同一个仓库恢复源码、字体、fixtures 和 `voice-library/`，再恢复制作数据并准备所需模型与工具。声线参考目录已经随工程提交，无须在工程旁边另外放一份。虚拟环境和 Node 原生模块需要与目标机器匹配；把整个旧虚拟环境复制过去不保证可运行。

### 恢复时不要直接合并覆盖

1. 停止当前项目任务和服务，先备份当前数据。
2. 将备份解压到一个**新的恢复目录**，保留原数据作为回退。
3. 校验归档 SHA-256，核对项目、图片和 runs 目录齐全。
4. 在 `.env.local` 将 `MOYO_DATA_DIR` 指向恢复出的 `data`，使用匹配的代码与声线环境启动；项目内恢复目录可用相对路径。
5. 打开原有项目，核对卡片、配图和旧成片；再复制一个项目做短导出验证。

例如已将归档解压到项目 `backups/restored/`，在 `.env.local` 写：

```dotenv
MOYO_DATA_DIR=./backups/restored/data
```

随后运行 `npm run dev`。CLI 和 worker 会读取同一配置，避免网页和 CLI 写入不同数据目录。

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
| 渲染报 `ffmpeg` / `ffprobe` 不存在 | `render.log`、`.env.local`、工具探测结果 | 核对 `MOYO_FFMPEG`/`MOYO_FFPROBE`；相对路径按项目根解析，Windows 使用原生 `.exe` |
| 浏览器可执行文件缺失 | `render.log`、项目 Chromium 安装、`MOYO_CHROMIUM` | 运行 `npx playwright install chromium`，或修正真实浏览器路径 |
| Windows / Intel Mac 新琪亚娜失败 | 当前平台与任务 `voice.log` | 该 MLX 路径仅 Apple Silicon Mac；复用归档原稿或手动选择晓晓 |
| 配图缺失或哈希不符 | `assets/<UUID>/metadata.json`、原图文件、项目引用 | 恢复配套原图，或重新上传产生新资产后重新关联；不要手改旧图伪装成同一个资产 |
| 卡片正文溢出 | `render.log`、当前卡片尺寸/配图布局、预览 | 增大卡片、换用合适的配图布局或拆分文案后重试 |
| 视频失败但配音已完成 | `audio-ready.json`、`voice-plan.json` | 按当前内容重试，已验证配音可复用，视频会重新逐帧渲染 |
| 存在 `video.partial.mp4` | 同任务状态、`render.log` | 这是未发布结果，不能手工改名当作成功成片 |
| 任务持续排队 | `logs/worker.log`、worker 锁、任务 JSON | 查询任务/刷新项目会尝试启动 worker；必要时在同环境执行 `npm run worker` |
| 程序中断后显示失败 | `stage: interrupted`、任务快照 | 恢复逻辑会标记中断，不自动续接部分视频；核对后重试 |

完整导出成功通常有以下证据组合：任务 `status=succeeded`、`outputs.video`、`runs/<ID>/video.mp4` 和 `render-report.json`。报告包含画面错误/溢出检查、编码参数及完整解码结果；它不代表资讯事实或配音逐字正确，内容和听感仍要检查。

macOS 直接查看任务日志：

```bash
cat 'data/jobs/实际任务ID.json'
tail -n 80 'data/runs/实际任务ID/voice.log'
tail -n 80 'data/runs/实际任务ID/render.log'
tail -n 80 'data/logs/worker.log'
```

Windows PowerShell 对应使用 `Get-Content -Encoding utf8 'data/jobs/实际任务ID.json'` 和 `Get-Content -Encoding utf8 'data/runs/实际任务ID/render.log' -Tail 80`。

发生中断时，worker 按记录的 PID、创建时间、任务目录及 Chromium 任务标记清理该任务遗留进程；Windows 使用任务树，macOS 使用进程组。不要结束所有 Node/Python 进程或直接删除活跃锁。手工操作前确认 PID、命令行和任务目录相符。

## 10. 维护时的验证范围

常规代码检查：

全新代码副本如果尚未生成 Next 类型文件，先运行一次开发服务或生产构建，再执行类型检查。

```bash
npm run typecheck
npm test
```

需要验证配音缓存和语速编排时：

```sh
npm run test:python
```

Python 回归通过统一 Python 探测执行 unittest discover，使用归档配音和负例，不进行新 MLX 推理或在线 TTS；它会在 `data/verification/voice-tests-*` 留下新的执行记录。Node 的存储/图片专项测试使用独立临时数据。Windows 仅文件 symlink 的权限不足场景逐项 `SKIP`，目录 containment 使用 junction 实测；浏览器依赖缺失不能当作通过。

完整运行链检查与构建：

```sh
npm run check:runtime
npm run build
```

`check:runtime` 需要已安装 Python、FFmpeg/FFprobe 和 Chromium，复制隔离工程并使用归档音轨，执行真实 prepare、短片渲染、取消及配音复用，不调用新模型或在线 TTS。GitHub Actions 在 `macos-latest` 与 `windows-latest` 使用 Node 20/Python 3.11 安装真实工具后跑完整检查，结果按具体运行记录填写 [VERIFICATION.md](VERIFICATION.md)。

生产构建检查与实际短片导出验证是不同环节：构建通过只能说明网页代码可构建，实际导出还依赖声线、浏览器、FFmpeg、配图和内容布局。应根据本次改动选择对应检查，避免每次文档修改都重新生成整期配音和视频。
