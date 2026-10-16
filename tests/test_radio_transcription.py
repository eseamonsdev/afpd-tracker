import importlib.util
import pathlib
import unittest
import tempfile
from types import SimpleNamespace
from unittest.mock import patch

path = pathlib.Path(__file__).resolve().parents[1] / 'scripts/transcribe_afpd_radio.py'
spec = importlib.util.spec_from_file_location('radio', path)
radio = importlib.util.module_from_spec(spec)
spec.loader.exec_module(radio)


class PublicationGuards(unittest.TestCase):
    def test_unresolved_is_withheld(self):
        for text in ['[unclear]', 'Turn at [Main?].', 'inaudible', '{redacted}', '<unknown>']:
            self.assertFalse(radio.eligible(text, False))
        self.assertFalse(radio.eligible('Possible wording.', True))
        self.assertFalse(radio.eligible('', False))
        self.assertTrue(radio.eligible('On my way.', False))

    def test_context_is_preceding_and_bounded(self):
        calls = [{'epoch': t} for t in [1, 30, 40, 90, 100, 101]]
        cfg = {'context_seconds': 60, 'context_calls': 3}
        self.assertEqual(radio.context_indices(calls, 4, cfg), [2, 3])
        self.assertEqual(radio.context_indices(calls, 0, cfg), [])
        self.assertEqual(radio.context_indices(calls, 5, cfg), [3, 4])

    def test_finalizer_preserves_metadata_and_rejects_rerun(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = pathlib.Path(tmp)
            date = '2026-10-15'
            calls = []
            clips = {}
            entries = []
            for i, text in enumerate(['On my way.', '[unclear]']):
                name = f'clip-{i}.m4a'
                (folder/name).write_bytes(b'test audio fixture')
                digest = radio.sha(folder/name)
                calls.append({'original_filename': name, 'sha256': digest,
                              'epoch': 1792080000+i, 'displayed_seconds': 2,
                              'custom_metadata': {'preserve': True}})
                clips[name] = {'sha256': digest, 'passes': {
                    p: {'token_cap_reached': False} for p in ['original','filtered','context']}}
                entries.append({'filename': name, 'text': text, 'needs_review': i == 1})
            data = {'date': date, 'talkgroup': 6001, 'coverage': 'complete', 'calls': calls}
            radio.write(folder/'calls.json', data)
            radio.write(folder/'passes.json', {'date': date, 'settings': radio.read(radio.SETTINGS),
                        'settings_sha256': 'fixture', 'clips': clips})
            radio.write(folder/'reviewed.json', {'date': date, 'settings_sha256': 'fixture', 'entries': entries})
            args = SimpleNamespace(date=date, passes=str(folder/'passes.json'), reviewed=str(folder/'reviewed.json'))
            with patch.object(radio, 'load_archive', return_value=(folder, data)):
                radio.finalize(args)
                saved = radio.read(folder/'calls.json')
                self.assertEqual(saved['calls'][0]['transcript'], 'On my way.')
                self.assertNotIn('transcript', saved['calls'][1])
                for c in saved['calls']:
                    self.assertEqual(c['custom_metadata'], {'preserve': True})
                    self.assertNotIn('validated', c)
                self.assertEqual((folder/'transcript.md').read_bytes(),
                                 (folder/'transcript-drafts/transcript-draft-1.md').read_bytes())
                before = (folder/'calls.json').read_bytes()
                with self.assertRaises(ValueError):
                    radio.finalize(args)
                self.assertEqual(before, (folder/'calls.json').read_bytes())


if __name__ == '__main__':
    unittest.main()
