import copy
import hashlib
import io
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from reorganize_voice_storage import encode, split_result, write_layout, migrate


def sample():
    return {'schema_version': 1, 'date': '2026-11-02', 'talkgroup': 6001,
            'model': 'speechbrain/spkrec-ecapa-voxceleb', 'model_revision': 'a' * 40,
            'source_metadata_sha256': 'b' * 64, 'min_speech_seconds': 3,
            'similarity_threshold': .70, 'clustering': 'complete-linkage-cosine',
            'human_verified': False, 'status': 'complete',
            'clips': [{'clip_number': 7, 'radio_ids': [14590105], 'status': 'embedded',
                       'embedding': [1.0, 0.0], 'voice': 'Voice 001', 'min_group_similarity': .8},
                      {'clip_number': 10, 'radio_ids': [14590105], 'status': 'embedded',
                       'embedding': [.8, .6], 'voice': 'Voice 001', 'min_group_similarity': .8}],
            'groups': [{'voice': 'Voice 001', 'clip_numbers': [7, 10]}]}


class Missing(Exception):
    response = {'Error': {'Code': 'NoSuchKey'}}


class MemoryR2:
    def __init__(self, objects=None):
        self.objects = dict(objects or {})
        self.writes = 0

    def get_object(self, *, Bucket, Key):
        if Key not in self.objects:
            raise Missing()
        return {'Body': io.BytesIO(self.objects[Key])}

    def put_object(self, *, Bucket, Key, Body, **kwargs):
        if kwargs.get('IfNoneMatch') == '*' and Key in self.objects:
            raise RuntimeError('PreconditionFailed')
        self.objects[Key] = Body
        self.writes += 1

    def get_paginator(self, operation):
        assert operation == 'list_objects_v2'
        return self

    def paginate(self, *, Bucket, Prefix):
        return [{'Contents': [{'Key': k} for k in self.objects if k.startswith(Prefix)]}]


class VoiceStorageTests(unittest.TestCase):
    def test_model_first_paths_keep_embeddings_and_daily_comparisons_separate(self):
        data = sample()
        folder = data['model'].replace('/', '--') + '--' + data['model_revision']
        root = f'voice-recognition/{folder}/6001'
        objects = split_result(data)
        self.assertIn(f"{root}/embeddings/{data['date']}/embeddings.json", objects)
        self.assertIn(f"{root}/comparisons/complete-linkage-cosine/threshold-0.70/{data['date']}/groups.json", objects)

    def test_threshold_changes_only_comparison_and_never_duplicates_embeddings(self):
        a = sample()
        b = copy.deepcopy(a)
        b['similarity_threshold'] = .75
        first, second = split_result(a), split_result(b)
        ek = next(k for k in first if '/embeddings/' in k)
        self.assertEqual(first[ek], second[ek])
        self.assertNotIn('similarity_threshold', json.loads(first[ek]))
        self.assertNotIn('voice', json.loads(first[ek])['clips'][0])
        ck = next(k for k in first if '/comparisons/' in k)
        comparison = json.loads(first[ck])
        self.assertIn('/threshold-0.70/', ck)
        self.assertNotIn('embedding', comparison['clips'][0])
        self.assertEqual(comparison['embeddings_sha256'], hashlib.sha256(first[ek]).hexdigest())
        self.assertEqual(comparison['groups'], a['groups'])
        self.assertEqual(json.loads(first[ek])['clips'][0]['embedding'], [1.0, 0.0])

    def test_revision_is_in_namespace_and_original_numbers_are_preserved(self):
        a = sample()
        first = split_result(a)
        a['model_revision'] = 'c' * 40
        self.assertFalse(set(first) & set(split_result(a)))
        self.assertEqual([c['clip_number'] for c in json.loads(next(
            v for k, v in first.items() if '/embeddings/' in k))['clips']], [7, 10])
        for change in [{'model': '../bad'}, {'model_revision': 'main'},
                       {'talkgroup': 5922}, {'selected_clip_numbers': [7]}]:
            with self.assertRaises(ValueError):
                split_result({**sample(), **change})

    def test_migration_is_dry_run_by_default_idempotent_and_preserves_original(self):
        key = 'voice-recognition/6001/2026-11-02/voices.json'
        original = encode(sample())
        client = MemoryR2({key: original, 'openmhz/unrelated': b'unchanged'})
        plan = migrate(client, 'bucket')
        self.assertEqual(client.writes, 0)
        self.assertEqual(len(plan['days']), 1)
        report = migrate(client, 'bucket', apply=True)
        self.assertFalse(report['errors'])
        self.assertEqual(client.writes, 2)
        self.assertEqual(client.objects[key], original)
        self.assertEqual(client.objects['openmhz/unrelated'], b'unchanged')
        migrate(client, 'bucket', apply=True)
        self.assertEqual(client.writes, 2)

    def test_conflict_rejects_day_before_any_write(self):
        objects = split_result(sample())
        key = next(k for k in objects if '/comparisons/' in k)
        client = MemoryR2({key: b'other result'})
        with self.assertRaises(ValueError):
            write_layout(client, 'bucket', objects)
        self.assertEqual(client.writes, 0)
        self.assertEqual(client.objects[key], b'other result')

    def test_bad_readback_fails(self):
        class CorruptR2(MemoryR2):
            def put_object(self, **kw):
                super().put_object(**kw)
                self.objects[kw['Key']] = b'corrupt'
        with self.assertRaises(ValueError):
            write_layout(CorruptR2(), 'bucket', split_result(sample()))


if __name__ == '__main__':
    unittest.main()
