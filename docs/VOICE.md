# 通用配音流水线

本地工作台通过 `scripts/build_voice.py` 生成整期或单场旁白。控制器只使用 Python 标准库；需要新琪亚娜语音时，才调用已有 MLX 虚拟环境。所有中间文件、缓存和执行记录都写在新工程的 `data/` 中。不会修改原工程、安装模型、修改全局配置或无声回退到另一种声线。

声线参考素材位于项目内 `voice-library/琪亚娜-稳重轻角色感/`，参考音频、参考文本和参数 3 个文件随同一个 Git 仓库提交。默认路径从项目根定位，移动或克隆整个项目时一同恢复。本文的 Mac 解释器路径与最后的真实生成记录保留原机器证据；它们不代表当前 Windows 机器已完成新口播合成环境迁移。

## 调用和输出

```bash
python3 scripts/build_voice.py \
  --input data/voice-request.json \
  --output data/outputs/example \
  --cache data/cache/voice
```

请求中的 `scenes` 顺序就是最终播放顺序。场景 id 必须唯一且非空；`speed` 支持 0.5–2.0。`seed` 可省略。

```json
{
  "preset": "kiana-base",
  "speed": 1.1,
  "scenes": [{"id": "intro", "narration": "开拓者，欢迎收看本期资讯。"}],
  "seed": {
    "baseAudio": "/绝对路径/fixtures/starrail-weekly/base-narration.wav",
    "baseEpisode": "/绝对路径/fixtures/starrail-weekly/base-episode.json",
    "editorial": "/绝对路径/fixtures/starrail-weekly/editorial.json"
  }
}
```

输出包含：

| 文件 | 内容 |
|---|---|
| `narration.wav` | 48 kHz、单声道、PCM s16le；视频合成使用此音轨 |
| `narration.m4a` | AAC 160 kbps，试听使用 |
| `voice-plan.json` | `VoicePlan`；每场 `cues` 是场内局部秒数，duration 含首尾停顿 |
| `voice-metadata.json` | 实际声线、依赖与模型身份、来源/缓存命中、音频哈希、响度数据和对齐方式 |
| `execution-records.jsonl` | 追加式记录；每次调用、分块生成、缓存复用、失败或取消均保留原始输入和实际产物位置 |
| `work/<run-id>/` | 原始 TTS 结果、日志、变速分段与拼接中间文件 |

stdout 仅输出每行一个 JSON 进度事件，格式为 `{ "stage": "voice", "progress": 0.5, "message": "..." }`。失败或取消返回非零退出码；新一次调用会先移除旧的 `voice-plan.json` 成功标记，失败产物不能误认为成品。

## 历史音轨复用

`kiana-base` 可以使用 `fixtures/starrail-weekly` 中归档的原速音轨。脚本同时读取旁边的 `base-voice-metadata.json`，核对声线为“琪亚娜-稳重轻角色感-v2-轻角色-基准”、原速为 1.0。仅有文字完全一致的场景才复用，优先匹配相同 id，复制/重排后的新 id 也可以按完整口播匹配。晓晓声线不复用琪亚娜音轨。

显式配置 `MOYO_MLX_PYTHON`、`MOYO_KIANA_MODEL`、`MOYO_KIANA_VOICE_DIR`、`MOYO_KIANA_REFERENCE`、`MOYO_KIANA_REFERENCE_TEXT` 或 `MOYO_KIANA_PRESETS` 时，会保守禁用历史 seed：即使预设仍叫 `kiana-base`、文字也没变化，仍按当前模型和参考素材计算强缓存指纹。覆盖路径不存在时明确失败，不会静默回放旧声线。元数据的 `seedBypassedForExplicitOverrides` 记录导致此选择的变量名。

原始字幕相对时码随该场景保存，抽取音轨不修改断句。1.1、1.2 等速度由原速音轨经过 FFmpeg `atempo` 处理，字幕做对应缩放，不会对已经加速过的音轨重复变速。每段按采样数确定长度并拼接，场景时长之和与实际 WAV 严格一致。

历史数据日期为 2026-10-02，只是模板素材，不代表当前日期的实时资讯。

## 新口播生成

- 琪亚娜：本地 Qwen3-TTS 1.7B Base 4bit / MLX-Audio，读取 v2-light 参考音频、参考文本和 `base` 参数。
- 晓晓：已有 `edge-tts`，声线 `zh-CN-XiaoxiaoNeural`，原始语速 `-5%`，需要网络。用户的 `speed` 再作为统一后处理倍率应用。
- 以完整句子组成的语义块合成；仅超长句按从句或长度拆分。字幕行宽不会导致逐行 TTS，从而减少生硬停顿。
- 只裁掉每个块外围静音，保留模型内部自然停顿；场景前后分别加 0.55/0.45 秒，跨块补 0.32 秒。
- 新字幕按语义短句、字数权重和邻近静音估计时间，不声称做过 ASR 强制对齐。现有字幕的精确微调和听感复核仍可能需要人工完成。
- 最后进行两遍响度处理，目标 -18 LUFS、True Peak 不高于 -1.8 dBFS；解码、时长和非大量静音检查通过后才发布成功计划。这些检查不替代人工听音或逐字 ASR 核验。

## 缓存与执行证据

缓存指纹含原文、真实声线名称、引擎/版本、模型位置与权重身份、模型配置哈希、参考音频 SHA-256、参考全文、参数、随机种子和流水线版本。历史 seed 单独包含原速音轨、时间轴、编辑稿和原声线元数据的 SHA-256。归档元数据未记录参考全文时不伪造该字段，其内容身份由归档元数据及参考音频哈希约束。

`speed` 不进入原速缓存，改语速可复用基础音轨。任何命中都核对音频 SHA-256 和 WAV 采样格式/长度，损坏的缓存重新生成或重新抽取。新合成失败时不写成功缓存清单。首次执行和复测写不同 `runId`，记录不会被重写。

## 本机依赖与覆盖变量

| 环境变量 | 当前默认 |
|---|---|
| `MOYO_MLX_PYTHON` | `/Users/shuidi/Documents/Codex/2026-09-25/ruh/work/jev-video/.venv_mlx_audio/bin/python` |
| `MOYO_KIANA_MODEL` | `~/.cache/huggingface/hub/models--mlx-community--Qwen3-TTS-12Hz-1.7B-Base-4bit/snapshots/37e955a1deb861c088ae5f3a67043185f3d1a60c` |
| `MOYO_KIANA_VOICE_DIR` | `<项目根>/voice-library/琪亚娜-稳重轻角色感`，随项目提交 |
| `MOYO_KIANA_REFERENCE` | 声线目录的 `kiana_refs_concat_v2_light.wav` |
| `MOYO_KIANA_REFERENCE_TEXT` | 声线目录的 `reference_audio_v2_light/ref_text.txt` |
| `MOYO_KIANA_PRESETS` | 声线目录的 `test/qwen17b-v2-light-versions/variants.json` |
| `MOYO_FFMPEG` / `MOYO_FFPROBE` | PATH 或 `~/.homebrew/bin/` 中已有命令 |
| `MOYO_EDGE_TTS` | PATH 或 `~/.local/bin/edge-tts` |

缺少本地模型、参考素材或环境时明确报错。MLX 推理设置 `HF_HUB_OFFLINE=1` 和 `TRANSFORMERS_OFFLINE=1`，避免隐式下载。控制器和它启动的 FFmpeg/MLX 子进程都不创建独立进程组；后台 worker 应将整个任务放入自己的进程组，并对该组发送取消信号，确保子进程一起停止。

## 已执行验证

```bash
python3 tests/voice_pipeline_test.py
```

该测试仅使用归档音频，覆盖：1.1 倍时长/局部字幕、1.2 倍及场景重排、复制 id 后匹配原稿、缓存损坏重建、重复 id/非法速度拒绝、语义分块与字幕切分独立，以及显式声线覆盖禁用 seed、缺失新参考素材不得冒充成功。测试输入、stdout/stderr 及流水线记录存入 `data/verification/voice-tests-*`。

另已实际生成一段新琪亚娜口播，原文为“开拓者，欢迎收看本期资讯。让我们一起看看新的活动安排。”，成品和逐条输入输出记录位于 `data/verification/voice-kiana-new/output`。此验证证明本机新口播路径能够输出有效音轨；未进行 ASR 逐字校验。

晓晓线上 TTS 也完成短句真实调用：“欢迎收看本期资讯。我们一起看看新的活动。”，结果位于 `data/verification/voice-xiaoxiao-new/output`。两段均使用 1.1 倍速，琪亚娜成品 5.417083 秒，晓晓成品 4.842417 秒。琪亚娜新推理环境实际报告 MLX 0.32.2、MLX-Audio 0.5.6；这些是当前本机检查结果，不是可移植项目的安装要求。
