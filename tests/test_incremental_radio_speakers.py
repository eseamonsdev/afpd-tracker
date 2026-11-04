import copy
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from group_radio_voices import MODEL, PREPROCESSING, load_existing_embeddings, reuse_cached_clip
from reorganize_voice_storage import encode, split_result, write_layout
from test_voice_storage import MemoryR2, sample


class IncrementalVoiceTests(unittest.TestCase):
    def test_existing_vector_is_reused_exactly_without_reextracting(self):
        cached = {'status': 'embedded', 'embedding': [.6, .8], 'speech_seconds': 4.0}
        clip = {'clip_number': 7}
        self.assertTrue(reuse_cached_clip(clip, cached, 2))
        self.assertEqual(clip['embedding'], cached['embedding'])
        self.assertIsNot(clip['embedding'], cached['embedding'])
        self.assertEqual(clip['status'], 'embedded')

    def test_only_newly_eligible_short_clips_need_extraction(self):
        clip = {}
        self.assertFalse(reuse_cached_clip(clip,
            {'status': 'skipped_short_speech', 'speech_seconds': 2.784}, 2))
        self.assertTrue(reuse_cached_clip(clip,
            {'status': 'skipped_short_speech', 'speech_seconds': 1.408}, 2))
        self.assertEqual(clip['speech_seconds'], 1.408)
        self.assertFalse(reuse_cached_clip({}, {'status': 'error'}, 2))
        self.assertFalse(reuse_cached_clip({}, None, 2))

    def test_invalid_cached_vectors_are_rejected(self):
        for vector in [[], [0, 0], [float('nan'), 1], [4, 5]]:
            with self.assertRaises(ValueError):
                reuse_cached_clip({}, {'status': 'embedded', 'embedding': vector,
                                       'speech_seconds': 4}, 2)

    def test_cache_requires_exact_audio_identity_and_preprocessing(self):
        data = sample()
        for c in data['clips']:
            c.update(filename=f"clip-{c['clip_number']}.m4a", call_id=str(c['clip_number']),
                     sha256=str(c['clip_number']) * 32, speech_seconds=4)
        objects = split_result(data)
        client = MemoryR2(objects)
        calls = [dict(id=str(n), original_filename=f'clip-{n}.m4a',
                      sha256=str(n) * 32) for n in range(1, 11)]
        cached, previous = load_existing_embeddings(client, 'bucket', data['date'],
                                                     data['model_revision'], calls)
        self.assertEqual(set(cached), {7, 10})
        calls[6]['sha256'] = 'changed'
        with self.assertRaises(ValueError):
            load_existing_embeddings(client, 'bucket', data['date'], data['model_revision'], calls)
        self.assertEqual(client.writes, 0)

    def test_append_preserves_old_vector_and_identical_rerun_has_no_writes(self):
        original = sample()
        old = split_result(original)
        changed = copy.deepcopy(original)
        changed['min_speech_seconds'] = 2
        changed['clips'].append({'clip_number': 11, 'radio_ids': [42], 'status': 'embedded',
                                 'embedding': [0.0, 1.0], 'speech_seconds': 2.2})
        new = split_result(changed)
        client = MemoryR2(old)
        write_layout(client, 'bucket', new, replace=True)
        for key in old:
            if '/embeddings/' in key:
                result = json.loads(client.objects[key])
                self.assertEqual(result['clips'][:2], json.loads(old[key])['clips'])
                self.assertEqual(len(result['clips']), 3)
        count = client.writes
        write_layout(client, 'bucket', new, replace=True)
        self.assertEqual(client.writes, count)

    def test_publish_refuses_vector_overwrite_or_removal_before_any_writes(self):
        original = sample()
        old = split_result(original)
        for mutate in ['change', 'remove']:
            changed = copy.deepcopy(original)
            if mutate == 'change':
                changed['clips'][0]['embedding'] = [0.0, 1.0]
            else:
                changed['clips'] = changed['clips'][1:]
            client = MemoryR2(old)
            with self.assertRaises(ValueError):
                write_layout(client, 'bucket', split_result(changed), replace=True)
            self.assertEqual(client.writes, 0)

    def test_run_counters_do_not_change_stored_embedding_content(self):
        original = sample()
        changed = {**original, 'run_counts': {'new_embeddings': 0, 'reused_embeddings': 2}}
        self.assertEqual(split_result(original), split_result(changed))


if __name__ == '__main__':
    unittest.main()
