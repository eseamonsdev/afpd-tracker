import sys
from pathlib import Path
import unittest

sys.path.insert(0, str(Path(__file__).parents[1] / 'scripts'))
from transcribe_radio_batches import available_targets


class AvailableAudioTests(unittest.TestCase):
    folder = 'openmhz-afpd-law-2-2026-10-29'
    cfg = {'context_calls': 3, 'context_seconds': 60}

    def call(self, epoch, saved=True):
        name = f'dcfems-5922-{epoch}.m4a'
        c = {'epoch': epoch, 'original_filename': name, 'sha256': 'a' * 64, 'size_bytes': 1}
        if saved:
            c['audio_storage'] = {'provider': 'r2', 'verified': True, 'bucket': 'audio',
                                  'key': f'openmhz/{self.folder}/{name}', 'sha256': 'a' * 64, 'size_bytes': 1}
        return c

    def test_unavailable_target_does_not_block_ready_later_target(self):
        data = {'calls': [self.call(100, False), self.call(200)]}
        self.assertEqual(available_targets(self.folder, data, [0, 1], self.cfg, {}), ([1], [0]))

    def test_required_missing_context_leaves_target_pending(self):
        data = {'calls': [self.call(100, False), self.call(120)]}
        self.assertEqual(available_targets(self.folder, data, [1], self.cfg, {}), ([], [1]))

    def test_saved_context_pass_does_not_require_audio_again(self):
        data = {'calls': [self.call(100, False), self.call(120)]}
        saved = {data['calls'][0]['original_filename']: {'passes': {'original': {'text': 'Copy.'}}}}
        self.assertEqual(available_targets(self.folder, data, [1], self.cfg, saved), ([1], []))

    def test_completed_target_remains_resumable_without_audio(self):
        data = {'calls': [self.call(100, False)]}
        saved = {data['calls'][0]['original_filename']: {'passes': {k: {} for k in ['original', 'filtered', 'context']}}}
        self.assertEqual(available_targets(self.folder, data, [0], self.cfg, saved), ([0], []))


if __name__ == '__main__':
    unittest.main()
