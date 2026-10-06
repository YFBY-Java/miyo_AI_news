"""Tests use archived speech, never call a remote service or run new MLX inference."""
import importlib.util
import json
import math
import os
from pathlib import Path
import platform
import subprocess
import sys
import unittest
import uuid
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('build_voice', ROOT / 'scripts/build_voice.py')
voice = importlib.util.module_from_spec(spec)
spec.loader.exec_module(voice)


class VoicePipelineTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.evidence = ROOT / 'data/verification' / ('voice-tests-' + uuid.uuid4().hex[:10])
        cls.evidence.mkdir(parents=True)
        cls.fixture = ROOT / 'fixtures/starrail-weekly'
        cls.editorial = voice.read_json(cls.fixture / 'editorial.json')
        cls.episode = voice.read_json(cls.fixture / 'base-episode.json')
        cls.seed = {key: str((cls.fixture / name).relative_to(ROOT)) for key, name in (
            ('baseAudio', 'base-narration.wav'), ('baseEpisode', 'base-episode.json'), ('editorial', 'editorial.json'))}

    def execute(self, name, scenes, speed=1.1, success=True, environment=None):
        request = {'preset': 'kiana-base', 'speed': speed, 'scenes': scenes, 'seed': self.seed}
        folder = self.evidence / name
        folder.mkdir()
        voice.write_json(folder / 'input.json', request)
        process = subprocess.run([sys.executable, str(ROOT/'scripts/build_voice.py'), '--input', str(folder/'input.json'),
                                  '--output', str(folder/'output'), '--cache', str(self.evidence/'cache')],
                                 capture_output=True, text=True, encoding='utf-8', errors='replace',
                                 cwd=self.evidence, env=os.environ | (environment or {}))
        voice.write_json(folder/'execution.json', {'caseId': name, 'input': request, 'exitCode': process.returncode,
                         'stdout': process.stdout, 'stderr': process.stderr, 'expectedSuccess': success,
                         'passed': (process.returncode == 0) == success, 'executedAt': voice.now()})
        self.assertEqual(process.returncode == 0, success, process.stdout + process.stderr)
        return folder/'output'

    def test_seed_speed_captions_reorder_and_cache_integrity(self):
        original = self.editorial['scenes'][:2]
        scenes = [{'id': s['id'], 'narration': s['narration']} for s in original]
        output = self.execute('seed-110', scenes)
        plan = voice.read_json(output/'voice-plan.json')
        meta = voice.read_json(output/'voice-metadata.json')
        self.assertEqual([s['method'] for s in meta['scenes']], ['seed', 'seed'])
        self.assertEqual([s['id'] for s in plan['scenes']], [s['id'] for s in scenes])
        self.assertAlmostEqual(sum(s['duration'] for s in plan['scenes']), plan['duration'], places=8)
        self.assertAlmostEqual(voice.wav_frames(output/'narration.wav')/48000, plan['duration'], places=8)
        for index, scene in enumerate(plan['scenes']):
            self.assertAlmostEqual(scene['duration'], self.episode['scenes'][index]['duration']/1.1, delta=.00003)
            self.assertTrue(all(0 <= c['start'] < c['end'] <= scene['duration'] for c in scene['cues']))
        self.assertAlmostEqual(plan['scenes'][0]['cues'][0]['start'], .55/1.1, places=6)
        self.assertLess(plan['scenes'][1]['cues'][0]['start'], 1)

        # Changed ordering and speed must reuse original speed cache without drift.
        second = self.execute('reorder-120', list(reversed(scenes)), speed=1.2)
        next_plan = voice.read_json(second/'voice-plan.json')
        next_meta = voice.read_json(second/'voice-metadata.json')
        self.assertEqual(next_plan['scenes'][0]['id'], scenes[1]['id'])
        self.assertTrue(all(s['cacheHit'] for s in next_meta['scenes']))
        self.assertAlmostEqual(next_plan['scenes'][0]['duration'], self.episode['scenes'][1]['duration']/1.2, delta=.00003)

        # A copied scene id should still find matching narration; changed text cannot.
        copied = self.execute('copied-id', [{'id': 'copy-id', 'narration': scenes[0]['narration']}])
        self.assertEqual(voice.read_json(copied/'voice-plan.json')['scenes'][0]['id'], 'copy-id')
        self.assertTrue(voice.read_json(copied/'voice-metadata.json')['scenes'][0]['cacheHit'])

        # Never trust success metadata if cached audio has been corrupted.
        key = meta['scenes'][0]['cacheFingerprint']
        cached = self.evidence / 'cache/scenes' / key / 'audio.wav'
        cached.write_bytes(b'not audio')
        repaired = self.execute('repair-cache', scenes[:1])
        self.assertFalse(voice.read_json(repaired/'voice-metadata.json')['scenes'][0]['cacheHit'])
        self.assertEqual(voice.wav_frames(repaired/'narration.wav'), voice.wav_frames(copied/'narration.wav'))

    def test_reject_duplicate_scene_ids(self):
        scene = {'id': 'repeated', 'narration': self.editorial['scenes'][0]['narration']}
        output = self.execute('reject-duplicates', [scene, scene], success=False)
        self.assertFalse((output/'voice-plan.json').exists())
        records = [json.loads(line) for line in (output/'execution-records.jsonl').read_text(encoding='utf-8').splitlines()]
        self.assertEqual(records[-1]['status'], 'failed')
        self.assertEqual(records[-1]['input']['scenes'], [scene, scene])

    def test_reject_invalid_speed_before_work(self):
        scene = {'id': 'one', 'narration': '正文。'}
        for value in [0, 2.1, True, math.nan]:
            with self.assertRaises(ValueError):
                voice.validate_input({'preset': 'kiana-base', 'speed': value, 'scenes': [scene]})

    def test_explicit_voice_identity_overrides_never_reuse_archived_seed(self):
        for key in voice.KIANA_IDENTITY_OVERRIDES:
            with self.subTest(variable=key), patch.dict(os.environ, {key: '/different/voice/configuration'}):
                self.assertIsNone(voice.load_seed(self.seed, 'kiana-base'))
        # A requested but missing reference must fail visibly, even when the text
        # exactly matches the historical demo. It must not silently play Kiana's
        # archived audio and claim the new configuration was used.
        original = self.editorial['scenes'][0]
        output = self.execute('missing-custom-reference',
                              [{'id': original['id'], 'narration': original['narration']}],
                              success=False,
                              environment={
                                  # Earlier path checks must not depend on an installed MLX environment.
                                  'MOYO_MLX_PYTHON': sys.executable,
                                  'MOYO_KIANA_MODEL': str(self.fixture),
                                  'MOYO_KIANA_REFERENCE': str(self.evidence/'missing-reference.wav'),
                              })
        self.assertFalse((output/'voice-plan.json').exists())
        records = [json.loads(line) for line in (output/'execution-records.jsonl').read_text(encoding='utf-8').splitlines()]
        self.assertEqual(records[-1]['status'], 'failed')
        supported_mlx = sys.platform == 'darwin' and platform.machine().lower() in ('arm64', 'aarch64')
        self.assertIn('参考音频' if supported_mlx else 'Apple Silicon', records[-1]['error'])
        self.assertFalse(any(r['status'] == 'reused-seed' for r in records))

    def test_semantic_blocks_preserve_text_and_do_not_split_at_caption_width(self):
        text = '开拓者，欢迎来到本期资讯。我们一起看看今天的活动安排。接下来是社区讨论。'
        self.assertEqual(voice.semantic_blocks(text), [text])
        self.assertGreater(len(voice.caption_parts(text)), 1)
        long = text*12 + '\n最后，再见。'
        blocks = voice.semantic_blocks(long)
        self.assertEqual(''.join(''.join(blocks).split()), ''.join(long.split()))
        self.assertTrue(all(len(block) <= 140 for block in blocks))
        cues, methods = voice.align_captions(text, 12, [(5.4, 5.7)])
        self.assertEqual(''.join(c['text'] for c in cues), text)
        self.assertEqual(cues[-1]['end'], 12)
        self.assertTrue(all(a['end'] == b['start'] for a,b in zip(cues, cues[1:])))


if __name__ == '__main__':
    unittest.main(verbosity=2)
