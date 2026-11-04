import copy
import hashlib
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from migrate_voice_model_layout import migrate, relocate, OLD_PREFIX
from reorganize_voice_storage import encode, split_result
from test_voice_storage import MemoryR2, sample


class Storage(MemoryR2):
    def __init__(self, objects=None):
        super().__init__(objects)
        self.deleted = []

    def delete_object(self, *, Bucket, Key):
        self.deleted.append(Key)
        del self.objects[Key]


def old_objects(data):
    new = split_result(data)
    folder = data['model'].replace('/', '--') + '--' + data['model_revision']
    day = data['date']
    objects = {}
    for key, content in new.items():
        if '/embeddings/' in key:
            target = f'{OLD_PREFIX}{day}/embeddings/{folder}/embeddings.json'
        else:
            target = f"{OLD_PREFIX}{day}/comparisons/{folder}/complete-linkage-cosine/threshold-0.70/groups.json"
            comparison = json.loads(content)
            comparison['embeddings_key'] = f'{OLD_PREFIX}{day}/embeddings/{folder}/embeddings.json'
            content = encode(comparison)
        objects[target] = content
    objects[f'{OLD_PREFIX}{day}/voices.json'] = encode(data)
    return objects


class ModelLayoutTests(unittest.TestCase):
    def test_paths_are_model_first_and_daily_only_where_needed(self):
        data = sample()
        folder = data['model'].replace('/', '--') + '--' + data['model_revision']
        root = f'voice-recognition/{folder}/6001'
        objects = split_result(data)
        self.assertIn(f"{root}/embeddings/{data['date']}/embeddings.json", objects)
        self.assertIn(f"{root}/comparisons/complete-linkage-cosine/threshold-0.70/{data['date']}/groups.json", objects)

    def test_dry_run_then_move_preserves_bytes_groups_and_unrelated_objects(self):
        old = old_objects(sample())
        client = Storage({**old, 'openmhz/audio.m4a': b'audio'})
        plan = migrate(client, 'bucket')
        self.assertEqual(client.writes, 0)
        self.assertEqual(client.deleted, [])
        self.assertEqual(plan['days'], 1)
        report = migrate(client, 'bucket', apply=True, remove_old=True)
        self.assertEqual(report['status'], 'moved_and_verified')
        self.assertEqual(len(client.deleted), 3)
        for key, original in old.items():
            target, expected = relocate(key, original)
            self.assertEqual(client.objects[target], expected)
            if '/embeddings/' in key or key.endswith('/voices.json'):
                self.assertEqual(expected, original)
            else:
                before, after = json.loads(original), json.loads(expected)
                self.assertEqual(before['groups'], after['groups'])
                self.assertEqual(before['embeddings_sha256'], after['embeddings_sha256'])
                self.assertEqual(hashlib.sha256(client.objects[after['embeddings_key']]).hexdigest(), after['embeddings_sha256'])
        for mode in ['test-runs', 'day-runs']:
            self.assertTrue(any(k.endswith(f'/profile-matching/{mode}/.keep') for k in client.objects))
        self.assertEqual(client.objects['openmhz/audio.m4a'], b'audio')
        count = client.writes
        migrate(client, 'bucket', apply=True, remove_old=True)
        self.assertEqual(client.writes, count)

    def test_conflict_prevents_every_write_and_delete(self):
        old = old_objects(sample())
        key = next(iter(old))
        target, _ = relocate(key, old[key])
        client = Storage({**old, target: b'other'})
        with self.assertRaises(ValueError):
            migrate(client, 'bucket', apply=True, remove_old=True)
        self.assertEqual(client.writes, 0)
        self.assertEqual(client.deleted, [])

    def test_unknown_old_objects_are_not_silently_lost(self):
        client = Storage({**old_objects(sample()), OLD_PREFIX + 'unknown.json': b'{}'})
        with self.assertRaises(ValueError):
            migrate(client, 'bucket', apply=True, remove_old=True)
        self.assertEqual(client.writes, 0)
        self.assertEqual(client.deleted, [])

    def test_failed_readback_retains_all_sources(self):
        class Corrupt(Storage):
            def put_object(self, **kw):
                super().put_object(**kw)
                self.objects[kw['Key']] = b'corrupt'
        old = old_objects(sample())
        client = Corrupt(old)
        with self.assertRaises(ValueError):
            migrate(client, 'bucket', apply=True, remove_old=True)
        self.assertEqual(client.deleted, [])
        for key, value in old.items():
            self.assertEqual(client.objects[key], value)

    def test_wrong_model_and_embedding_snapshot_are_rejected(self):
        old = old_objects(sample())
        key = next(k for k in old if '/comparisons/' in k)
        data = json.loads(old[key])
        data['embeddings_sha256'] = 'f' * 64
        client = Storage({**old, key: encode(data)})
        with self.assertRaises(ValueError):
            migrate(client, 'bucket', apply=True, remove_old=True)
        self.assertEqual(client.writes, 0)
        self.assertEqual(client.deleted, [])
        data = sample()
        data['model_revision'] = 'main'
        with self.assertRaises(ValueError):
            relocate(next(k for k in old if k.endswith('/voices.json')), encode(data))

    def test_copy_can_be_completed_before_separate_cleanup(self):
        client = Storage(old_objects(sample()))
        migrate(client, 'bucket', apply=True)
        self.assertEqual(client.deleted, [])
        count = client.writes
        migrate(client, 'bucket', apply=True, remove_old=True)
        self.assertEqual(client.writes, count)
        self.assertEqual(len(client.deleted), 3)


if __name__ == '__main__':
    unittest.main()
