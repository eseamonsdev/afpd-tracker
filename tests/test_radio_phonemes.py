import copy
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import radio_phonemes as phonemes


class Missing(Exception):
    response = {'Error': {'Code': 'NoSuchKey'}}


class Conflict(Exception):
    response = {'Error': {'Code': 'PreconditionFailed'}}


class Storage:
    def __init__(self):
        self.objects = {}
        self.writes = []

    def get_object(self, *, Bucket, Key):
        if (Bucket, Key) not in self.objects:
            raise Missing()
        return {'Body': io.BytesIO(self.objects[Bucket, Key])}

    def put_object(self, *, Bucket, Key, Body, **kwargs):
        if kwargs.get('IfNoneMatch') == '*' and (Bucket, Key) in self.objects:
            raise Conflict()
        self.objects[Bucket, Key] = Body
        self.writes.append(Key)


class PhonemeTests(unittest.TestCase):
    def archive(self, root, tg, day, calls):
        folder = phonemes.archive_path(root, day, tg)
        folder.mkdir(parents=True, exist_ok=True)
        (folder / 'calls.json').write_text(json.dumps({'date': day, 'talkgroup': tg, 'calls': calls}))
        return folder

    def test_every_talkgroup_and_day_and_batching(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            for tg in (6001, 5922, 6036):
                self.archive(root, tg, '2026-11-24', [{}, {}])
            result = phonemes.plan(root)
            self.assertEqual((result['selected_archives'], result['selected_clips']), (3, 6))
            self.assertEqual({j['talkgroup'] for j in result['include']}, {6001, 5922, 6036})
            last = phonemes.plan(root, batch_size=2, batch_index=1)
            self.assertEqual(len(last['include']), 1)
            self.assertEqual(last['batch_count'], 2)
            self.assertEqual(len(phonemes.plan(root, talkgroups='6036')['include']), 1)
            with self.assertRaises(ValueError):
                phonemes.plan(root, days='2026-11-25')
            with self.assertRaises(ValueError):
                phonemes.plan(root, batch_size=257)

    def test_archive_identity_mismatch_is_not_silently_excluded(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            folder = self.archive(root, 6036, '2026-11-24', [])
            data = json.loads((folder / 'calls.json').read_text())
            data['talkgroup'] = 6001
            (folder / 'calls.json').write_text(json.dumps(data))
            with self.assertRaises(ValueError):
                phonemes.inventory(root)

    def test_timestamps_are_analysis_windows_not_invented_durations(self):
        result = phonemes.timed_phones('0.000 0.045 ɹ\n0.060 0.045 ɛ\n0.120 0.045 tʰ')
        self.assertEqual(result['sequence'], 'ɹ ɛ tʰ')
        self.assertEqual(result['frames'][2]['start_seconds'], .12)
        self.assertNotIn('duration_seconds', result['frames'][0])
        self.assertEqual(phonemes.timed_phones(''), {'sequence': '', 'frames': []})
        for invalid in ('0.3 0.045 n\n0.1 0.045 t', 'nan 0.045 n', '0 -1 n', '-0.1 0.045 n'):
            with self.assertRaises(ValueError):
                phonemes.timed_phones(invalid)

    def test_new_settings_and_models_do_not_overwrite_existing_results(self):
        a = phonemes.prefix(6001, '2026-11-24', {'settings': phonemes.SETTINGS})
        changed = copy.deepcopy(phonemes.SETTINGS)
        changed['inventories'] = ['eng']
        b = phonemes.prefix(6001, '2026-11-24', {'settings': changed})
        self.assertNotEqual(a, b)
        self.assertIn('allosaurus--uni2005--' + phonemes.MODEL_SHA256, a)
        with patch.object(phonemes, 'MODEL_SHA256', 'a' * 64):
            self.assertNotEqual(a, phonemes.prefix(6001, '2026-11-24', {'settings': phonemes.SETTINGS}))

    def test_immutable_publication_requires_identical_bytes(self):
        storage = Storage()
        phonemes.publish(storage, 'bucket', 'key', b'original', immutable=True)
        phonemes.publish(storage, 'bucket', 'key', b'original', immutable=True)
        with self.assertRaises(ValueError):
            phonemes.publish(storage, 'bucket', 'key', b'different', immutable=True)
        self.assertEqual(storage.objects['bucket', 'key'], b'original')

    def test_partial_failure_resumes_without_redecoding_completed_audio(self):
        storage = Storage()
        payloads = [b'one', b'bad', b'three']
        calls = [{'id': str(i), 'original_filename': f'dcfems-6036-{100+i}.m4a',
                  'sha256': phonemes.sha256(payload), 'size_bytes': len(payload),
                  'transcript': 'Do not change this', 'validated': True}
                 for i, payload in enumerate(payloads)]
        calls.append({'id': 'unavailable', 'original_filename': 'dcfems-6036-999.m4a',
                      'audio_status': 'unavailable'})
        fail = [True]
        decoded = []

        class Engine:
            def recognize(self, path, language, **kwargs):
                payload = (Path(path).parent / 'audio.m4a').read_bytes()
                decoded.append((payload, language))
                if payload == b'bad' and fail[0]:
                    raise ValueError('test bad clip')
                return '0.000 0.045 ɹ\n0.060 0.045 ɛ'

        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            folder = self.archive(root, 6036, '2026-11-24', calls)
            original = (folder / 'calls.json').read_bytes()
            args = phonemes.Namespace(root=root, day='2026-11-24', talkgroup=6036,
                                      model_dir=root / 'model', output=root / 'out',
                                      publish=True, checkpoint_every=1)
            by_hash = {phonemes.sha256(p): p for p in payloads}
            with patch('r2_audio.client_and_bucket', return_value=(storage, 'bucket')), \
                 patch.object(phonemes, 'ensure_model', return_value=root), \
                 patch.object(phonemes, 'runtime_versions', return_value={'allosaurus': '1.0.2'}), \
                 patch.object(phonemes, 'recognizer', return_value=Engine()), \
                 patch.object(phonemes, 'source_audio', side_effect=lambda cl, bu, fo, ca: by_hash[ca['sha256']]), \
                 patch.object(phonemes.subprocess, 'run'):
                self.assertEqual(phonemes.run_day(args), 1)
                first = json.loads((args.output / 'phonemes.json').read_bytes())
                self.assertEqual(first['counts']['decoded'], 2)
                self.assertEqual(first['counts']['error'], 1)
                self.assertEqual(first['counts']['unavailable'], 1)
                self.assertFalse(first['complete'])
                self.assertTrue(first['attempted_all'])
                saved = {k: v for k, v in storage.objects.items() if '/clips/' in k[1]}
                fail[0] = False
                decoded.clear()
                self.assertEqual(phonemes.run_day(args), 0)
                second = json.loads((args.output / 'phonemes.json').read_bytes())
                self.assertEqual(second['counts']['reused'], 2)
                self.assertEqual(second['counts']['new'], 1)
                self.assertEqual(second['counts']['decoded'], 3)
                self.assertFalse(second['complete'])  # Unavailable is not falsely called decoded.
                self.assertEqual(decoded, [(b'bad', 'eng'), (b'bad', 'ipa')])
                for key, value in saved.items():
                    self.assertEqual(storage.objects[key], value)
                # A fully cached retry should not initialize the recognition model.
                with patch.object(phonemes, 'recognizer', side_effect=AssertionError('must reuse')):
                    self.assertEqual(phonemes.run_day(args), 0)
            self.assertEqual((folder / 'calls.json').read_bytes(), original)


if __name__ == '__main__':
    unittest.main()
