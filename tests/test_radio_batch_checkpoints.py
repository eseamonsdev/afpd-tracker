import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).parents[1] / 'scripts'))
from transcribe_6001_batches import checkpoint, cleanup_audio, completed, restore


class CheckpointTests(unittest.TestCase):
    def test_partial_resume_and_identity_guard(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp) / 'text'
            calls = [{'original_filename': 'dcfems-6001-123.m4a', 'epoch': 123, 'sha256': 'a' * 64}]
            data = {'date': '2026-10-25', 'calls': calls}
            clips = {calls[0]['original_filename']: {'index': 1, 'epoch': 123, 'sha256': 'a' * 64,
                     'passes': {'original': {'text': 'Candidate'}}}}
            checkpoint(directory, data, {}, 'settings', clips, 10, 'interrupted')
            self.assertEqual(restore(directory, data, 'settings'), clips)
            self.assertFalse(completed(next(iter(clips.values()))))
            self.assertEqual(json.loads((directory / 'status.json').read_text())['remaining_clips'], 1)
            with self.assertRaises(ValueError):
                restore(directory, data, 'changed-settings')
            calls[0]['sha256'] = 'b' * 64
            with self.assertRaises(ValueError):
                restore(directory, data, 'settings')

    def test_cleanup_removes_audio_but_keeps_saved_text(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            audio = root / '6001-audio-test'
            audio.mkdir()
            (audio / 'original.m4a').write_bytes(b'audio')
            (audio / 'filtered.wav').write_bytes(b'filtered')
            text = root / 'batch-001.json'
            text.write_text('{}')
            cleanup_audio(audio)
            self.assertFalse(audio.exists())
            self.assertTrue(text.exists())


if __name__ == '__main__':
    unittest.main()
