"""Portable runtime tests without downloading models or contacting TTS services."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('portable_build_voice', ROOT / 'scripts/build_voice.py')
voice = importlib.util.module_from_spec(spec)
spec.loader.exec_module(voice)


class PythonRuntimeTest(unittest.TestCase):
    def test_explicit_tool_path_is_project_relative_even_from_another_directory(self):
        with tempfile.TemporaryDirectory() as project, tempfile.TemporaryDirectory() as cwd:
            root = Path(project)
            tool = root / 'tools' / 'ffmpeg.exe'
            tool.parent.mkdir()
            tool.write_bytes(b'tool')
            previous = Path.cwd()
            try:
                os.chdir(cwd)
                with patch.object(voice, 'ROOT', root), patch.dict(os.environ, {'MOYO_FFMPEG': 'tools/ffmpeg.exe'}):
                    self.assertEqual(Path(voice.binary('ffmpeg')), tool.resolve())
            finally:
                os.chdir(previous)

    def test_explicit_command_name_is_resolved_on_path(self):
        with patch.dict(os.environ, {'MOYO_FFMPEG': 'custom-ffmpeg'}), \
             patch.object(voice.shutil, 'which', return_value=sys.executable):
            self.assertEqual(Path(voice.binary('ffmpeg')), Path(sys.executable).resolve())

    def test_explicit_missing_tool_does_not_fall_back_to_installed_tool(self):
        with patch.dict(os.environ, {'MOYO_FFMPEG': 'missing/tool.exe'}):
            with self.assertRaisesRegex(RuntimeError, 'MOYO_FFMPEG'):
                voice.binary('ffmpeg')

    def test_windows_rejects_shell_scripts_as_explicit_tools(self):
        with tempfile.TemporaryDirectory() as project:
            for extension in ('.cmd', '.bat', '.ps1', ''):
                tool = Path(project) / ('ffmpeg' + extension)
                tool.write_bytes(b'tool')
                with self.subTest(extension=extension), patch.object(voice.sys, 'platform', 'win32'), \
                     patch.dict(os.environ, {'MOYO_FFMPEG': str(tool)}):
                    with self.assertRaisesRegex(RuntimeError, r'\.exe'):
                        voice.binary('ffmpeg')

    def test_windows_looks_up_exe_for_bare_command_overrides_and_path(self):
        with tempfile.TemporaryDirectory() as project:
            tool = Path(project) / 'custom-ffmpeg.exe'
            tool.write_bytes(b'tool')
            with patch.object(voice, 'ROOT', Path(project)), patch.object(voice.sys, 'platform', 'win32'), \
                 patch.dict(os.environ, {'MOYO_FFMPEG': 'custom-ffmpeg'}), \
                 patch.object(voice.shutil, 'which', return_value=str(tool)) as lookup:
                self.assertEqual(Path(voice.binary('ffmpeg')), tool.resolve())
                lookup.assert_called_once_with('custom-ffmpeg.exe')
            with patch.object(voice, 'ROOT', Path(project)), patch.object(voice.sys, 'platform', 'win32'), \
                 patch.dict(os.environ, {}, clear=True), \
                 patch.object(voice.shutil, 'which', return_value=str(tool)) as lookup:
                self.assertEqual(Path(voice.binary('ffmpeg')), tool.resolve())
                lookup.assert_called_once_with('ffmpeg.exe')

    def test_windows_rejects_non_exe_returned_by_path_lookup(self):
        with tempfile.TemporaryDirectory() as project:
            tool = Path(project) / 'ffmpeg.cmd'
            tool.write_bytes(b'tool')
            with patch.object(voice, 'ROOT', Path(project)), patch.object(voice.sys, 'platform', 'win32'), \
                 patch.dict(os.environ, {}, clear=True), \
                 patch.object(voice.shutil, 'which', return_value=str(tool)):
                with self.assertRaisesRegex(RuntimeError, r'\.exe'):
                    voice.binary('ffmpeg')

    def test_project_virtualenv_tool_discovery_for_windows_and_unix(self):
        for platform, folder, suffix in [('win32', 'Scripts', '.exe'), ('darwin', 'bin', '')]:
            with self.subTest(platform=platform), tempfile.TemporaryDirectory() as project:
                root = Path(project)
                tool = root / '.venv' / folder / ('edge-tts' + suffix)
                tool.parent.mkdir(parents=True)
                tool.write_bytes(b'tool')
                with patch.object(voice, 'ROOT', root), patch.object(voice.sys, 'platform', platform), \
                     patch.dict(os.environ, {}, clear=True), patch.object(voice.shutil, 'which', return_value=None):
                    self.assertEqual(Path(voice.binary('edge-tts')), tool.resolve())

    def test_ffprobe_uses_explicit_ffmpeg_sibling(self):
        with tempfile.TemporaryDirectory() as project:
            root = Path(project)
            suffix = '.exe' if sys.platform == 'win32' else ''
            ffmpeg, ffprobe = (root / ('ffmpeg' + suffix), root / ('ffprobe' + suffix))
            ffmpeg.write_bytes(b'tool')
            ffprobe.write_bytes(b'tool')
            with patch.dict(os.environ, {'MOYO_FFMPEG': str(ffmpeg)}, clear=True), \
                 patch.object(voice.shutil, 'which', return_value=None):
                self.assertEqual(Path(voice.binary('ffprobe')), ffprobe.resolve())

    def test_python_child_output_and_progress_use_utf8(self):
        with patch.dict(os.environ, {'PYTHONIOENCODING': 'ascii', 'PYTHONUTF8': '0'}):
            self.assertEqual(voice.run([sys.executable, '-c', 'print("跨平台配音。")']).strip(), '跨平台配音。')
            result = subprocess.run([sys.executable, '-c',
                'import importlib.util; s=importlib.util.spec_from_file_location("voice",' + repr(str(ROOT / 'scripts/build_voice.py')) + '); '
                'm=importlib.util.module_from_spec(s); s.loader.exec_module(m); m.configure_stdio(); m.emit(1,"配音完成。")'],
                capture_output=True, env=os.environ)
            self.assertEqual(result.returncode, 0, result.stderr.decode('utf-8', errors='replace'))
            self.assertEqual(json.loads(result.stdout.decode('utf-8'))['message'], '配音完成。')

    def test_windows_subprocesses_are_hidden_and_decode_utf8(self):
        completed = subprocess.CompletedProcess(['tool'], 0, stdout='中文', stderr='')
        with patch.object(voice.sys, 'platform', 'win32'), patch.object(voice.subprocess, 'run', return_value=completed) as process:
            self.assertEqual(voice.run(['tool']), '中文')
            options = process.call_args.kwargs
            self.assertEqual(options.get('encoding'), 'utf-8')
            self.assertEqual(options.get('errors'), 'replace')
            self.assertEqual(options.get('creationflags'), 0x08000000)

    def test_mlx_defaults_are_local_and_custom_paths_are_project_relative(self):
        self.assertTrue(voice.DEFAULT_MLX_PYTHON.is_relative_to(ROOT / '.venv-mlx'))
        self.assertTrue(voice.DEFAULT_MODEL.is_relative_to(ROOT / 'models'))
        with tempfile.TemporaryDirectory() as project:
            root = Path(project)
            for name in ['env/bin/python', 'models/custom/model.safetensors', 'models/custom/config.json', 'voice/ref.wav']:
                file = root / name
                file.parent.mkdir(parents=True, exist_ok=True)
                file.write_text('{}', encoding='utf-8')
            (root / 'voice/ref.txt').write_text('中文参考。', encoding='utf-8')
            (root / 'voice/presets.json').write_text(json.dumps({'variants': [{'id': 'base', 'temperature': .7,
                'top_p': .9, 'top_k': 50, 'repetition_penalty': 1.05}]}), encoding='utf-8')
            overrides = {'MOYO_MLX_PYTHON': 'env/bin/python', 'MOYO_KIANA_MODEL': 'models/custom',
                         'MOYO_KIANA_VOICE_DIR': 'voice', 'MOYO_KIANA_REFERENCE': 'voice/ref.wav',
                         'MOYO_KIANA_REFERENCE_TEXT': 'voice/ref.txt', 'MOYO_KIANA_PRESETS': 'voice/presets.json'}
            with patch.object(voice, 'ROOT', root), patch.dict(os.environ, overrides), \
                 patch.object(voice.sys, 'platform', 'darwin'), patch.object(voice.platform, 'machine', return_value='arm64'), \
                 patch.object(voice, 'run', return_value='{"mlx":"test","mlx-audio":"test"}'):
                config = voice.voice_configuration('kiana-base')
            self.assertEqual(Path(config['python']), root / 'env/bin/python')
            self.assertEqual(Path(config['model']), root / 'models/custom')
            self.assertEqual(Path(config['reference']), root / 'voice/ref.wav')
            self.assertEqual(config['referenceText'], '中文参考。')

    def test_new_mlx_inference_explains_supported_platform(self):
        for platform, machine in [('win32', 'AMD64'), ('darwin', 'x86_64')]:
            with self.subTest(platform=platform), patch.object(voice.sys, 'platform', platform), \
                 patch.object(voice.platform, 'machine', return_value=machine):
                with self.assertRaisesRegex(RuntimeError, 'Apple Silicon'):
                    voice.voice_configuration('kiana-base')
                with self.assertRaisesRegex(RuntimeError, 'Apple Silicon'):
                    voice.internal_synthesize(Path('missing.json'), Path('output'))

    def test_seed_paths_are_project_relative_without_mlx(self):
        fixture = ROOT / 'fixtures/starrail-weekly'
        seed = {'baseAudio': 'fixtures/starrail-weekly/base-narration.wav',
                'baseEpisode': 'fixtures/starrail-weekly/base-episode.json',
                'editorial': 'fixtures/starrail-weekly/editorial.json'}
        with tempfile.TemporaryDirectory() as cwd:
            previous = Path.cwd()
            try:
                os.chdir(cwd)
                with patch.dict(os.environ, {}, clear=True), patch.object(voice.sys, 'platform', 'win32'):
                    loaded = voice.load_seed(seed, 'kiana-base')
                self.assertEqual(loaded['audio'], fixture / 'base-narration.wav')
                self.assertGreater(len(loaded['scenes']), 0)
            finally:
                os.chdir(previous)

    def test_project_env_local_precedes_env_and_external_settings_win(self):
        with tempfile.TemporaryDirectory() as project:
            root = Path(project)
            (root / '.env').write_text('MOYO_FFMPEG=tools/default ffmpeg\nMOYO_FFPROBE=tools/ffprobe\n', encoding='utf-8')
            (root / '.env.local').write_text('\ufeff# local configuration\nexport MOYO_FFMPEG="tools/本地 ffmpeg" # chosen\n'
                "MOYO_EDGE_TTS='tools/edge-tts'\nMOYO_KIANA_MODEL=models/local # offline\n", encoding='utf-8')
            with patch.object(voice, 'ROOT', root), patch.dict(os.environ, {'MOYO_EDGE_TTS': 'external-edge'}, clear=True):
                voice.load_project_environment()
                self.assertEqual(os.environ['MOYO_FFMPEG'], 'tools/本地 ffmpeg')
                self.assertEqual(os.environ['MOYO_FFPROBE'], 'tools/ffprobe')
                self.assertEqual(os.environ['MOYO_EDGE_TTS'], 'external-edge')
                self.assertEqual(os.environ['MOYO_KIANA_MODEL'], 'models/local')


if __name__ == '__main__':
    unittest.main(verbosity=2)
