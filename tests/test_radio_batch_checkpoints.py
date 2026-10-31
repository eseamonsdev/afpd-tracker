import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch
import transcribe_radio_batches as batches

sys.path.insert(0, str(Path(__file__).parents[1] / 'scripts'))
from transcribe_6001_batches import checkpoint, cleanup_audio, completed, restore


class CheckpointTests(unittest.TestCase):
    def test_checkpoint_retries_rejected_pushes_without_force(self):
        commands = []
        failures = [1, 1, 1, 1, 0]
        def git(cmd, **kwargs):
            commands.append(cmd)
            result = failures.pop(0) if cmd[1] == 'push' else 1 if cmd[1] == 'diff' else 0
            return SimpleNamespace(returncode=result)
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            directory = root / 'transcription-work/5922/2026-10-29'
            with patch.object(batches, 'ROOT', root), \
                 patch.object(batches.subprocess, 'run', side_effect=git), \
                 patch.object(batches.time, 'sleep'):
                batches.commit_checkpoint(directory, '2026-10-29', 100, 1000, 5922)
        self.assertEqual(sum(c[1] == 'push' for c in commands), 5)
        self.assertEqual(sum(c[1] == 'rebase' for c in commands), 5)
        self.assertFalse(any('--force' in c for c in commands))

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
