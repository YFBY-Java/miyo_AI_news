#!/usr/bin/env python3
"""Local, resumable narration generation. No third-party imports in the controller."""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import math
import os
from pathlib import Path
import platform
import re
import shutil
import signal
import subprocess
import sys
import time
import uuid
import wave

ROOT = Path(__file__).resolve().parents[1]
SAMPLE_RATE = 48000
PIPELINE_VERSION = 1
KIANA_NAME = '琪亚娜-稳重轻角色感-v2-轻角色-基准'
DEFAULT_MLX_PYTHON = ROOT / '.venv-mlx' / ('Scripts/python.exe' if sys.platform == 'win32' else 'bin/python')
DEFAULT_MODEL = ROOT / 'models/Qwen3-TTS-12Hz-1.7B-Base-4bit'
DEFAULT_VOICE = ROOT / 'voice-library/琪亚娜-稳重轻角色感'
KIANA_IDENTITY_OVERRIDES = (
    'MOYO_MLX_PYTHON', 'MOYO_KIANA_MODEL', 'MOYO_KIANA_VOICE_DIR',
    'MOYO_KIANA_REFERENCE', 'MOYO_KIANA_REFERENCE_TEXT', 'MOYO_KIANA_PRESETS',
)


def configure_stdio():
    # Job progress is read by Node as UTF-8, including on Windows consoles.
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, 'reconfigure'):
            stream.reconfigure(encoding='utf-8', errors='replace')


def load_project_environment():
    # Match the server entry point: external variables win; local overrides
    # the shared file. Keep the controller independent of third-party packages.
    for name in ('.env.local', '.env'):
        path = ROOT / name
        if not path.is_file():
            continue
        for line in path.read_text(encoding='utf-8-sig').splitlines():
            match = re.match(r'^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$', line)
            if not match:
                continue
            key, value = match.groups()
            if value.startswith(('"', "'")):
                quote = value[0]
                end = value.rfind(quote)
                value = value[1:end] if end > 0 else value
                if quote == '"':
                    value = value.replace('\\n', '\n').replace('\\r', '\r')
            else:
                value = value.split(' #', 1)[0].strip()
            os.environ.setdefault(key, value)


def project_path(value):
    path = Path(value).expanduser()
    return (path if path.is_absolute() else ROOT / path).resolve()


def require_mlx_platform():
    if sys.platform != 'darwin' or platform.machine().lower() not in ('arm64', 'aarch64'):
        raise RuntimeError('新生成琪亚娜配音需要 Apple Silicon Mac 的 MLX 环境；'
                           '当前平台可复用历史琪亚娜音轨，或选择晓晓（edge-tts）在线配音。')


def now():
    return dt.datetime.now().astimezone().isoformat()


def emit(progress, message):
    print(json.dumps({'stage': 'voice', 'progress': progress, 'message': message}, ensure_ascii=False), flush=True)


def sha(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True).encode()).hexdigest()


def write_json(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    temporary.replace(path)


def read_json(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def binary(name):
    def found_tool(path):
        path = Path(path)
        if sys.platform == 'win32' and path.suffix.lower() != '.exe':
            raise RuntimeError(f'Windows 的 {name} 工具必须为 .exe 程序：{path}；不支持 shell 脚本。')
        return str(path.resolve())

    variable = 'MOYO_' + name.upper().replace('-', '_')
    value = os.environ.get(variable)
    if value:
        candidate = project_path(value)
        found = candidate if candidate.is_file() else None
        if not found and not any(separator in value for separator in ('/', '\\')):
            command = value + '.exe' if sys.platform == 'win32' and not Path(value).suffix else value
            located = shutil.which(command)
            found = Path(located).resolve() if located else None
        if not found:
            raise RuntimeError(f'{variable} 指定的 {name} 不存在：{value}；路径相对项目根目录。')
        return found_tool(found)
    suffix = '.exe' if sys.platform == 'win32' else ''
    executable = name + suffix
    if name == 'ffprobe':
        try:
            sibling = Path(binary('ffmpeg')).with_name(executable)
            if sibling.is_file():
                return found_tool(sibling)
        except RuntimeError:
            pass
    candidate = ROOT / '.venv' / ('Scripts' if sys.platform == 'win32' else 'bin') / executable
    if candidate.is_file():
        return found_tool(candidate)
    located = shutil.which(executable)
    if located and Path(located).is_file():
        return found_tool(located)
    if sys.platform != 'win32':
        directories = [Path('/opt/homebrew/bin'), Path('/usr/local/bin')]
        try:
            directories.extend([Path.home() / '.homebrew/bin', Path.home() / '.local/bin'])
        except RuntimeError:
            pass
        for directory in directories:
            candidate = directory / executable
            if candidate.is_file():
                return found_tool(candidate)
    raise RuntimeError(f'缺少 {name}；请安装已有工具或配置 {variable}，不会自动安装。')


def invoke(arguments, *, env=None, **options):
    child_environment = dict(os.environ if env is None else env)
    child_environment['PYTHONIOENCODING'] = 'utf-8'
    child_environment['PYTHONUTF8'] = '1'
    windows = {'creationflags': getattr(subprocess, 'CREATE_NO_WINDOW', 0x08000000)} if sys.platform == 'win32' else {}
    return subprocess.run(arguments, text=True, encoding='utf-8', errors='replace',
                          env=child_environment, **windows, **options)


def run(arguments, *, timeout=1200, log=None, env=None):
    # Children stay in the controller's process tree for worker cancellation.
    if log:
        with Path(log).open('w', encoding='utf-8') as handle:
            result = invoke(arguments, stdout=handle, stderr=subprocess.STDOUT, timeout=timeout, env=env)
        if result.returncode:
            raise RuntimeError(f'子进程失败（{result.returncode}），完整输出：{log}')
        return ''
    result = invoke(arguments, capture_output=True, timeout=timeout, env=env)
    if result.returncode:
        raise RuntimeError(f'{Path(arguments[0]).name} 失败：{result.stderr[-2500:]}')
    return result.stdout


def audio_info(path):
    data = json.loads(run([binary('ffprobe'), '-v', 'error', '-select_streams', 'a:0',
                           '-show_entries', 'format=duration:stream=codec_name,sample_rate,channels',
                           '-of', 'json', str(path)]))
    if not data.get('streams'):
        raise RuntimeError(f'没有音轨：{path}')
    stream = data['streams'][0]
    return {'duration': float(data['format']['duration']), 'codec': stream['codec_name'],
            'sampleRate': int(stream['sample_rate']), 'channels': stream['channels']}


def wav_frames(path):
    with wave.open(str(path), 'rb') as source:
        if source.getframerate() != SAMPLE_RATE or source.getnchannels() != 1 or source.getsampwidth() != 2:
            raise RuntimeError(f'音轨格式需要 48kHz 单声道 PCM s16le：{path}')
        return source.getnframes()


def concat_wavs(paths, output):
    with wave.open(str(output), 'wb') as writer:
        writer.setnchannels(1)
        writer.setsampwidth(2)
        writer.setframerate(SAMPLE_RATE)
        for path in paths:
            wav_frames(path)
            with wave.open(str(path), 'rb') as reader:
                while chunk := reader.readframes(SAMPLE_RATE):
                    writer.writeframesraw(chunk)


def write_silence(writer, seconds):
    writer.writeframesraw(b'\0\0' * round(seconds * SAMPLE_RATE))


def timed_blocks(blocks, output, lead=.55, tail=.45, pause=.32):
    cues = []
    cursor = lead
    with wave.open(str(output), 'wb') as writer:
        writer.setparams((1, 2, SAMPLE_RATE, 0, 'NONE', 'not compressed'))
        write_silence(writer, lead)
        for index, block in enumerate(blocks):
            cues.extend({'start': cursor+c['start'], 'end': cursor+c['end'], 'text': c['text']} for c in block['cues'])
            with wave.open(str(block['audio']), 'rb') as reader:
                writer.writeframesraw(reader.readframes(reader.getnframes()))
            cursor += block['duration']
            suffix = tail if index == len(blocks)-1 else pause
            write_silence(writer, suffix)
            cursor += suffix
    return cues


def semantic_blocks(text, maximum=140):
    """Keep sentences together; caption line breaks never drive TTS calls."""
    blocks = []
    for paragraph in text.splitlines():
        if not paragraph.strip():
            continue
        parts = re.findall(r'.+?(?:[。！？!?]+[”’」』]?|$)', paragraph)
        units = []
        for part in parts:
            if len(part) <= maximum:
                units.append(part)
                continue
            clauses = re.findall(r'.+?(?:[，,；;：:]+|$)', part)
            for clause in clauses:
                units.extend(clause[i:i+maximum] for i in range(0, len(clause), maximum))
        current = ''
        for part in units:
            if current and len(current) + len(part) > maximum:
                blocks.append(current.strip())
                current = ''
            current += part
        if current.strip():
            blocks.append(current.strip())
    if ''.join(''.join(blocks).split()) != ''.join(text.split()):
        raise RuntimeError('语义分块丢失了原稿内容，已停止生成。')
    return blocks


def caption_parts(text, maximum=34):
    clauses = re.findall(r'.+?(?:[。！？!?，,；;：:]+[”’」』]?|$)', text, flags=re.S)
    result, current = [], ''
    for clause in clauses:
        while len(clause) > maximum:
            if current:
                result.append(current)
                current = ''
            result.append(clause[:maximum])
            clause = clause[maximum:]
        if current and len(current) + len(clause) > maximum:
            result.append(current)
            current = ''
        current += clause
    if current:
        result.append(current)
    return result or [text]


def silence_ranges(path):
    result = invoke([binary('ffmpeg'), '-hide_banner', '-nostats', '-i', str(path),
                             '-af', 'silencedetect=noise=-40dB:d=0.12', '-f', 'null', '-'],
                    capture_output=True, check=True)
    ranges, start = [], None
    for line in result.stderr.splitlines():
        if 'silence_start:' in line:
            start = float(line.split('silence_start:')[1].split()[0])
        if 'silence_end:' in line and start is not None:
            ranges.append((start, float(line.split('silence_end:')[1].split()[0])))
            start = None
    return ranges


def align_captions(text, duration, silences):
    parts = caption_parts(text)
    weights = [max(1, sum(c.isalnum() for c in part)) for part in parts]
    boundaries, methods, accumulated = [0.0], [], 0
    minimum = min(.25, duration / (len(parts) * 2))
    for index, weight in enumerate(weights[:-1]):
        accumulated += weight
        expected = duration * accumulated / sum(weights)
        low, high = boundaries[-1] + minimum, duration - minimum*(len(parts)-index-1)
        candidates = [(a+b)/2 for a, b in silences if low < (a+b)/2 < high
                      and abs((a+b)/2-expected) < min(1.0, duration*.10)]
        selected = min(candidates, key=lambda value: abs(value-expected)) if candidates else expected
        boundaries.append(max(low, min(high, selected)))
        methods.append('nearby-silence' if candidates else 'proportional-estimate')
    boundaries.append(duration)
    return [{'start': boundaries[i], 'end': boundaries[i+1], 'text': part} for i, part in enumerate(parts)], methods


class Records:
    def __init__(self, output, request):
        self.path = output / 'execution-records.jsonl'
        self.run_id = uuid.uuid4().hex
        self.request = request
        self.started = now()
        self.clock = time.monotonic()

    def append(self, case, status, inputs, outputs=None, *, elapsed=0, error=None):
        record = {'caseId': case, 'executionId': uuid.uuid4().hex, 'runId': self.run_id,
                  'executedAt': now(), 'environment': {'project': str(ROOT), 'python': sys.executable,
                  'platform': sys.platform, 'pipelineVersion': PIPELINE_VERSION},
                  'input': inputs, 'actualOutput': outputs, 'status': status,
                  'elapsedSeconds': round(elapsed, 3), 'error': error,
                  'evidencePath': str(self.path)}
        with self.path.open('a', encoding='utf-8') as handle:
            handle.write(json.dumps(record, ensure_ascii=False) + '\n')
        return record


def cached_entry(folder, fingerprint):
    try:
        manifest = read_json(folder / 'manifest.json')
        audio = folder / 'audio.wav'
        if manifest.get('fingerprint') != fingerprint or manifest.get('sha256') != sha(audio):
            return None
        frames = wav_frames(audio)
        if frames <= 0 or abs(frames / SAMPLE_RATE - manifest['duration']) > 1/SAMPLE_RATE:
            return None
        return manifest | {'audio': str(audio)}
    except (FileNotFoundError, ValueError, KeyError, wave.Error, RuntimeError):
        return None


def publish_cache(folder, fingerprint, audio, cues, details):
    folder.mkdir(parents=True, exist_ok=True)
    temporary = folder / ('audio.' + uuid.uuid4().hex + '.wav')
    shutil.copyfile(audio, temporary)
    temporary.replace(folder / 'audio.wav')
    manifest = {'fingerprint': fingerprint, 'sha256': sha(folder / 'audio.wav'),
                'duration': wav_frames(folder / 'audio.wav') / SAMPLE_RATE,
                'cues': cues, 'createdAt': now(), 'details': details}
    write_json(folder / 'manifest.json', manifest)
    return manifest | {'audio': str(folder / 'audio.wav')}


def voice_configuration(preset):
    if preset == 'xiaoxiao':
        executable = binary('edge-tts')
        return {'engine': 'edge-tts', 'voice': 'zh-CN-XiaoxiaoNeural', 'executable': executable,
                'runtimeVersion': run([executable, '--version'], timeout=20).strip(),
                'parameters': {'rate': '-5%', 'pitch': '+0Hz', 'volume': '+0%'}}
    require_mlx_platform()
    voice = project_path(os.environ.get('MOYO_KIANA_VOICE_DIR', DEFAULT_VOICE))
    python = project_path(os.environ.get('MOYO_MLX_PYTHON', DEFAULT_MLX_PYTHON))
    model = project_path(os.environ.get('MOYO_KIANA_MODEL', DEFAULT_MODEL))
    reference = project_path(os.environ.get('MOYO_KIANA_REFERENCE', voice / 'kiana_refs_concat_v2_light.wav'))
    ref_text_file = project_path(os.environ.get('MOYO_KIANA_REFERENCE_TEXT', voice / 'reference_audio_v2_light/ref_text.txt'))
    preset_file = project_path(os.environ.get('MOYO_KIANA_PRESETS', voice / 'test/qwen17b-v2-light-versions/variants.json'))
    for label, path in [('MLX Python', python), ('琪亚娜模型目录', model), ('参考音频', reference),
                        ('参考文本', ref_text_file), ('声线参数', preset_file)]:
        if not path.exists():
            raise RuntimeError(f'缺少 {label}：{path}；请配置 MOYO_* 路径。')
    preset_data = next((item for item in read_json(preset_file)['variants'] if item['id'] == 'base'), None)
    if not preset_data:
        raise RuntimeError('声线参数中没有 base 预设。')
    parameters = {key: preset_data[key] for key in ('temperature', 'top_p', 'top_k', 'repetition_penalty')}
    parameters['max_tokens'] = 1800
    model_files = sorted(model.glob('*.safetensors'))
    if not model_files or not (model / 'config.json').is_file():
        raise RuntimeError(f'本地模型不完整：{model}，不会联网下载模型。')
    runtime = json.loads(run([str(python), '-c',
        'import importlib.metadata as m,importlib.util,json; assert importlib.util.find_spec("mlx"); '
        'print(json.dumps({n:m.version(n) for n in ["mlx","mlx-audio"]}))'], timeout=30))
    return {'engine': 'mlx-qwen3', 'voice': KIANA_NAME, 'python': str(python), 'runtimeVersion': runtime,
            'model': str(model), 'modelIdentity': {'configSha256': sha(model / 'config.json'),
                'weights': [{'path': str(p.resolve()), 'size': p.stat().st_size,
                             'mtimeNs': p.stat().st_mtime_ns} for p in model_files]},
            'reference': str(reference), 'referenceSha256': sha(reference),
            'referenceText': ref_text_file.read_text(encoding='utf-8').replace('\n', ''),
            'presetFileSha256': sha(preset_file), 'parameters': parameters}


def load_seed(seed, preset):
    if not seed or preset != 'kiana-base':
        return None
    # The historical recording has a fixed model/reference identity. Explicit
    # overrides represent a new voice configuration, even if the preset label is
    # unchanged. Conservatively bypass the seed and let the normal strong cache
    # fingerprint check the actual model, reference audio/text and parameters.
    if any(key in os.environ for key in KIANA_IDENTITY_OVERRIDES):
        return None
    audio, episode_path, editorial_path = (project_path(seed[key]) for key in ('baseAudio', 'baseEpisode', 'editorial'))
    for path in (audio, episode_path, editorial_path):
        if not path.is_file():
            raise RuntimeError(f'历史音轨素材缺失：{path}')
    metadata_path = episode_path.with_name('base-voice-metadata.json')
    if not metadata_path.is_file():
        raise RuntimeError('历史音轨缺少 base-voice-metadata.json，无法核对声线身份。')
    metadata = read_json(metadata_path)
    if metadata.get('voice') != KIANA_NAME or metadata.get('tempo') != 1.0:
        raise RuntimeError('历史音轨不是琪亚娜基准原速音轨，拒绝混用。')
    episode, editorial = read_json(episode_path), read_json(editorial_path)
    frames = wav_frames(audio)
    identity = {'engine': 'archived-kiana-base', 'voice': KIANA_NAME, 'baseAudioSha256': sha(audio),
                'episodeSha256': sha(episode_path), 'editorialSha256': sha(editorial_path),
                'voiceMetadataSha256': sha(metadata_path), 'model': metadata.get('model'),
                'referenceSha256': metadata.get('referenceSha256'), 'parameters': metadata.get('parameters'),
                'referenceText': None}
    by_id = {s['id']: s for s in episode['scenes']}
    candidates = []
    for scene in editorial['scenes']:
        timed = by_id.get(scene['id'])
        if not timed:
            continue
        start, end = timed['start'], timed['start'] + timed['duration']
        if start < 0 or end > frames / SAMPLE_RATE + .002:
            raise RuntimeError(f'历史分镜超出音轨范围：{scene["id"]}')
        cues = [{'start': max(0, c['start']-start), 'end': min(timed['duration'], c['end']-start), 'text': c['text']}
                for c in episode['cues'] if c['start'] >= start-.00001 and c['end'] <= end+.00001]
        candidates.append({'id': scene['id'], 'narration': scene['narration'], 'start': start,
                           'duration': timed['duration'], 'cues': cues})
    return {'audio': audio, 'identity': identity, 'scenes': candidates}


def seed_scene(scene, seed, cache, work, records):
    if not seed:
        return None
    matches = [s for s in seed['scenes'] if s['narration'] == scene['narration']]
    if not matches:
        return None
    selected = next((s for s in matches if s['id'] == scene['id']), matches[0])
    inputs = {'text': scene['narration'], 'voice': seed['identity'], 'sourceScene': selected,
              'pipelineVersion': PIPELINE_VERSION}
    key = digest(inputs)
    folder = cache / 'scenes' / key
    started = time.monotonic()
    saved = cached_entry(folder, key)
    hit = bool(saved)
    if not saved:
        raw = work / (key + '.wav')
        first = round(selected['start'] * SAMPLE_RATE)
        count = round(selected['duration'] * SAMPLE_RATE)
        with wave.open(str(seed['audio']), 'rb') as reader, wave.open(str(raw), 'wb') as writer:
            writer.setparams((1, 2, SAMPLE_RATE, 0, 'NONE', 'not compressed'))
            reader.setpos(first)
            writer.writeframes(reader.readframes(count))
        saved = publish_cache(folder, key, raw, selected['cues'], inputs)
    records.append('seed-scene:' + scene['id'], 'cache-hit' if hit else 'reused-seed', inputs,
                   {'audio': saved['audio'], 'sha256': saved['sha256'], 'duration': saved['duration'],
                    'cues': saved['cues']}, elapsed=time.monotonic()-started)
    return saved | {'method': 'seed', 'cacheHit': hit}


def synthesize_block(text, config, cache, work, records):
    parameters = {'text': text, 'voice': config, 'randomSeed': 20261102,
                  'pipelineVersion': PIPELINE_VERSION, 'exteriorTrimDb': -50}
    key = digest(parameters)
    folder = cache / 'blocks' / key
    saved = cached_entry(folder, key)
    if saved:
        records.append('tts-block:' + key, 'cache-hit', parameters,
                       {'audio': saved['audio'], 'sha256': saved['sha256'], 'duration': saved['duration'], 'cues': saved['cues']})
        return saved
    directory = work / key
    directory.mkdir(parents=True, exist_ok=True)
    request = directory / 'input.json'
    write_json(request, parameters)
    started = time.monotonic()
    records.append('tts-block:' + key, 'started', parameters, {'inputFile': str(request)})
    try:
        if config['engine'] == 'mlx-qwen3':
            env = os.environ.copy()
            env['HF_HUB_OFFLINE'] = '1'
            env['TRANSFORMERS_OFFLINE'] = '1'
            run([config['python'], str(Path(__file__).resolve()), '--internal-synthesize', str(request),
                 '--output', str(directory)], log=directory / 'generation.log', env=env)
            raw = directory / 'voice_000.wav'
        else:
            raw = directory / 'raw.mp3'
            run([config['executable'], '--voice', config['voice'], '--rate=' + config['parameters']['rate'],
                 '--pitch=' + config['parameters']['pitch'], '--volume=' + config['parameters']['volume'],
                 '--text', text, '--write-media', str(raw)], log=directory / 'generation.log')
        if not raw.is_file() or raw.stat().st_size < 1000:
            raise RuntimeError(f'合成器未产生有效音轨，详见 {directory / "generation.log"}')
        trimmed = directory / 'trimmed.wav'
        trim = ('silenceremove=start_periods=1:start_duration=0.03:start_threshold=-50dB:start_silence=0.06,'
                'areverse,silenceremove=start_periods=1:start_duration=0.03:start_threshold=-50dB:start_silence=0.10,areverse')
        run([binary('ffmpeg'), '-y', '-v', 'error', '-i', str(raw), '-af', trim,
             '-ar', str(SAMPLE_RATE), '-ac', '1', '-c:a', 'pcm_s16le', str(trimmed)])
        length = wav_frames(trimmed) / SAMPLE_RATE
        symbols = max(1, sum(c.isalnum() for c in text))
        if not max(.20, symbols*.06) < length < max(20, symbols*1.2):
            raise RuntimeError(f'合成时长 {length:.2f}s 异常，请检查音频内容。')
        silences = silence_ranges(trimmed)
        if sum(b-a for a, b in silences) > length*.80:
            raise RuntimeError('合成结果大部分为静音，拒绝缓存。')
        cues, alignment = align_captions(text, length, silences)
        saved = publish_cache(folder, key, trimmed, cues,
                              parameters | {'alignment': alignment, 'generationLog': str(directory / 'generation.log')})
        records.append('tts-block:' + key, 'succeeded', parameters,
                       {'rawAudio': str(raw), 'audio': saved['audio'], 'sha256': saved['sha256'],
                        'duration': length, 'cues': cues, 'generationLog': str(directory / 'generation.log'),
                        'validation': 'Decodable audio and duration/silence checks; no ASR semantic claim.'},
                       elapsed=time.monotonic()-started)
        return saved
    except BaseException as error:
        records.append('tts-block:' + key, 'cancelled' if isinstance(error, KeyboardInterrupt) else 'failed',
                       parameters, {'workDirectory': str(directory)}, elapsed=time.monotonic()-started, error=str(error))
        raise


def generated_scene(scene, config, cache, work, records):
    inputs = {'narration': scene['narration'], 'voice': config, 'lead': .55, 'tail': .45,
              'blockPause': .32, 'pipelineVersion': PIPELINE_VERSION}
    key = digest(inputs)
    folder = cache / 'scenes' / key
    saved = cached_entry(folder, key)
    if saved:
        records.append('tts-scene:' + scene['id'], 'cache-hit', inputs,
                       {'audio': saved['audio'], 'sha256': saved['sha256'], 'duration': saved['duration'], 'cues': saved['cues']})
        return saved | {'method': 'tts', 'cacheHit': True}
    blocks = [synthesize_block(text, config, cache, work, records) for text in semantic_blocks(scene['narration'])]
    assembled = work / (key + '.wav')
    cues = timed_blocks(blocks, assembled)
    saved = publish_cache(folder, key, assembled, cues, inputs)
    records.append('tts-scene:' + scene['id'], 'succeeded', inputs,
                   {'audio': saved['audio'], 'sha256': saved['sha256'], 'duration': saved['duration'], 'cues': cues})
    return saved | {'method': 'tts', 'cacheHit': False}


def normalize(source, output, frames):
    first = invoke([binary('ffmpeg'), '-hide_banner', '-nostats', '-i', str(source),
                            '-af', 'loudnorm=I=-18:TP=-1.8:LRA=7:print_format=json', '-f', 'null', '-'],
                   capture_output=True, check=True)
    try:
        measurement = json.JSONDecoder().raw_decode(first.stderr[first.stderr.rfind('{'):])[0]
        if not all(math.isfinite(float(measurement[key])) for key in ('input_i', 'input_tp', 'input_lra', 'input_thresh', 'target_offset')):
            raise ValueError('non-finite loudness')
    except (ValueError, KeyError) as error:
        raise RuntimeError('音轨响度无法测量，可能全为静音。') from error
    filters = (f'loudnorm=I=-18:TP=-1.8:LRA=7:measured_I={measurement["input_i"]}:'
               f'measured_TP={measurement["input_tp"]}:measured_LRA={measurement["input_lra"]}:'
               f'measured_thresh={measurement["input_thresh"]}:offset={measurement["target_offset"]}:'
               f'linear=true,aresample={SAMPLE_RATE},apad,atrim=end_sample={frames}')
    run([binary('ffmpeg'), '-y', '-v', 'error', '-i', str(source), '-af', filters,
         '-ar', str(SAMPLE_RATE), '-ac', '1', '-c:a', 'pcm_s16le', str(output)])
    return measurement


def validate_input(data):
    if data.get('preset') not in ('kiana-base', 'xiaoxiao'):
        raise ValueError('preset 必须为 kiana-base 或 xiaoxiao。')
    speed = data.get('speed')
    if isinstance(speed, bool) or not isinstance(speed, (int, float)) or not math.isfinite(speed) or not .5 <= speed <= 2:
        raise ValueError('speed 必须为 0.5–2.0。')
    scenes = data.get('scenes')
    if not isinstance(scenes, list) or not scenes or len(scenes) > 100:
        raise ValueError('需要 1–100 个分镜。')
    ids = set()
    for scene in scenes:
        if not isinstance(scene, dict) or not isinstance(scene.get('id'), str) or not scene['id'].strip() or scene['id'] in ids:
            raise ValueError('分镜 id 必须唯一且非空。')
        if not isinstance(scene.get('narration'), str) or not scene['narration'].strip() or len(scene['narration']) > 10000:
            raise ValueError('每个分镜需要 1–10000 字的口播。')
        ids.add(scene['id'])


def build(data, output, cache, records):
    validate_input(data)
    binary('ffmpeg')
    binary('ffprobe')
    work = output / 'work' / records.run_id
    work.mkdir(parents=True, exist_ok=True)
    cache.mkdir(parents=True, exist_ok=True)
    seed = load_seed(data.get('seed'), data['preset'])
    seed_overrides = [key for key in KIANA_IDENTITY_OVERRIDES if key in os.environ]
    if data.get('seed') and data['preset'] == 'kiana-base' and seed_overrides:
        emit(.02, '自定义琪亚娜声线配置已禁用历史音轨复用，将校验当前声线缓存')
    config = None
    prepared, details, scaled_files = [], [], []
    for index, scene in enumerate(data['scenes']):
        emit(.05 + .72*index/len(data['scenes']), f'处理口播 {index+1}/{len(data["scenes"])}：{scene["id"]}')
        saved = seed_scene(scene, seed, cache, work, records)
        if saved is None:
            if config is None:
                config = voice_configuration(data['preset'])
            saved = generated_scene(scene, config, cache, work, records)
        target_frames = round(wav_frames(saved['audio']) / data['speed'])
        scaled = work / f'scene-{index:03d}-speed.wav'
        run([binary('ffmpeg'), '-y', '-v', 'error', '-i', saved['audio'], '-af',
             f'atempo={data["speed"]},apad,atrim=end_sample={target_frames}',
             '-ar', str(SAMPLE_RATE), '-ac', '1', '-c:a', 'pcm_s16le', str(scaled)])
        length = wav_frames(scaled) / SAMPLE_RATE
        cues = [{'start': max(0, c['start']/data['speed']), 'end': min(length, c['end']/data['speed']),
                 'text': c['text']} for c in saved['cues']]
        if not cues or any(c['end'] <= c['start'] for c in cues):
            raise RuntimeError(f'字幕时间异常：{scene["id"]}')
        prepared.append({'id': scene['id'], 'duration': length, 'cues': cues})
        scaled_files.append(scaled)
        details.append({'id': scene['id'], 'method': saved['method'], 'cacheHit': saved['cacheHit'],
                        'baseDuration': saved['duration'], 'duration': length,
                        'cacheFingerprint': saved['fingerprint'], 'baseAudioSha256': saved['sha256']})
    emit(.81, '拼接音轨并进行响度处理')
    assembled = work / 'assembled.wav'
    concat_wavs(scaled_files, assembled)
    total_frames = wav_frames(assembled)
    normalized = work / 'narration.wav'
    loudness = normalize(assembled, normalized, total_frames)
    m4a = work / 'narration.m4a'
    run([binary('ffmpeg'), '-y', '-v', 'error', '-i', str(normalized), '-c:a', 'aac', '-b:a', '160k', str(m4a)])
    emit(.94, '校验音频与字幕时间轴')
    actual = audio_info(normalized)
    if wav_frames(normalized) != total_frames or abs(sum(s['duration'] for s in prepared)-actual['duration']) > .001:
        raise RuntimeError('音轨时长与时间轴不一致。')
    run([binary('ffmpeg'), '-v', 'error', '-i', str(normalized), '-f', 'null', '-'])
    plan = {'duration': total_frames/SAMPLE_RATE, 'scenes': prepared, 'preset': data['preset'],
            'speed': data['speed'], 'audioFile': 'narration.wav'}
    metadata = {'pipelineVersion': PIPELINE_VERSION, 'createdAt': now(), 'runId': records.run_id,
                'voice': KIANA_NAME if data['preset'] == 'kiana-base' else 'zh-CN-XiaoxiaoNeural',
                'preset': data['preset'], 'speed': data['speed'], 'duration': plan['duration'],
                'sampleRate': SAMPLE_RATE, 'channels': 1, 'audioSha256': sha(normalized),
                'scenes': details, 'engineConfiguration': config,
                'seedIdentity': seed['identity'] if seed else None, 'loudnessPass1': loudness,
                'seedBypassedForExplicitOverrides': seed_overrides if data['preset'] == 'kiana-base' else [],
                'captionAlignment': 'Seed preserves authored captions; new text uses semantic split and nearby silence, with proportional estimates. Not forced ASR alignment.',
                'executionRecords': str(records.path), 'request': data}
    normalized.replace(output / 'narration.wav')
    m4a.replace(output / 'narration.m4a')
    write_json(output / 'voice-metadata.json', metadata)
    write_json(output / 'voice-plan.json', plan)
    records.append('voice-pipeline', 'succeeded', data,
                   {'voicePlan': plan, 'audio': str(output/'narration.wav'), 'audioSha256': metadata['audioSha256'],
                    'metadata': str(output/'voice-metadata.json'), 'validation': actual},
                   elapsed=time.monotonic()-records.clock)
    emit(1, f'配音完成，共 {plan["duration"]:.2f} 秒')


def internal_synthesize(input_path, output):
    require_mlx_platform()
    os.environ['HF_HUB_OFFLINE'] = '1'
    os.environ['TRANSFORMERS_OFFLINE'] = '1'
    import mlx.core as mx
    from mlx_audio.tts.utils import load_model
    from mlx_audio.tts.generate import generate_audio
    request = read_json(input_path)
    config = request['voice']
    mx.random.seed(request['randomSeed'])
    model = load_model(config['model'])
    generate_audio(text=request['text'], model=model, ref_audio=config['reference'],
                   ref_text=config['referenceText'], lang_code='zh', voice=None,
                   output_path=str(output), file_prefix='voice', audio_format='wav', verbose=False,
                   **config['parameters'])
    mx.clear_cache()


def interrupted(signum, _frame):
    raise KeyboardInterrupt(f'配音任务被取消（signal {signum}）。')


def main():
    configure_stdio()
    load_project_environment()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--cache', type=Path)
    parser.add_argument('--internal-synthesize', type=Path, help=argparse.SUPPRESS)
    args = parser.parse_args()
    signal.signal(signal.SIGTERM, interrupted)
    if args.internal_synthesize:
        internal_synthesize(project_path(args.internal_synthesize), project_path(args.output))
        return
    if not args.input or not args.cache:
        parser.error('--input 和 --cache 为必填参数。')
    output, cache = project_path(args.output), project_path(args.cache)
    output.mkdir(parents=True, exist_ok=True)
    request = read_json(project_path(args.input))
    records = Records(output, request)
    records.append('voice-pipeline', 'started', request)
    # Never leave a previous success marker after an unsuccessful rerun.
    (output / 'voice-plan.json').unlink(missing_ok=True)
    try:
        build(request, output, cache, records)
    except BaseException as error:
        cancelled = isinstance(error, KeyboardInterrupt)
        records.append('voice-pipeline', 'cancelled' if cancelled else 'failed', request,
                       elapsed=time.monotonic()-records.clock, error=str(error))
        emit(0, str(error))
        raise SystemExit(130 if cancelled else 1) from None


if __name__ == '__main__':
    main()
