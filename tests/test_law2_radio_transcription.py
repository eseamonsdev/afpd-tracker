import copy
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import transcribe_law2_trial as trial


class Law2TranscriptionGuards(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name) / 'repo'
        self.work = Path(self.tmp.name) / 'passes'
        self.folder = self.root / 'public/records/openmhz/openmhz-afpd-law-2-2026-10-01'
        self.folder.mkdir(parents=True)
        self.work.mkdir()
        self.calls = []
        for i in range(2):
            epoch = 1790834427 + i
            name = f'dcfems-5922-{epoch}.m4a'
            (self.folder / name).write_bytes(b'fixture-' + bytes([i]))
            self.calls.append({'id': f'id-{i}', 'epoch': epoch,
                'original_filename': name, 'sha256': trial.sha(self.folder / name),
                'audio_duration_seconds': 1.408, 'displayed_seconds': 13,
                'source_duration_matches': False, 'custom_metadata': {'preserve': True}})
        self.data = {'date': trial.DAY, 'talkgroup': 5922, 'count': 2,
                     'coverage': 'unknown', 'coverage_note': 'Retain source discrepancy',
                     'calls': self.calls}
        trial.write(self.folder / 'calls.json', self.data)
        self.cfg = trial.read(trial.SETTINGS)
        self.signature = trial.manifest_signature(self.data)
        self.settings_signature = hashlib.sha256(trial.SETTINGS.read_bytes()).hexdigest()

    def make_passes(self):
        for kind in trial.KINDS:
            state = {'date': trial.DAY, 'talkgroup': 5922, 'kind': kind,
                     'settings': self.cfg, 'settings_sha256': self.settings_signature,
                     'manifest_signature': self.signature, 'elapsed_seconds': 1, 'clips': {}}
            for i, c in enumerate(self.calls):
                state['clips'][c['original_filename']] = {
                    'index': i + 1, 'epoch': c['epoch'], 'sha256': c['sha256'],
                    'passes': {kind: {'text': 'On my way.', 'token_cap_reached': False}}}
            trial.write(self.work / (kind + '.json'), state)

    def make_review(self):
        r = {'date': trial.DAY, 'talkgroup': 5922,
             'manifest_signature': self.signature, 'settings_sha256': self.settings_signature,
             'entries': [{'filename': c['original_filename'],
                          'text': 'On my way.' if i == 0 else '[unintelligible]',
                          'needs_review': bool(i)} for i, c in enumerate(self.calls)]}
        trial.write(self.work / 'reviewed.json', r)
        return r

    def test_unknown_coverage_and_documented_duration_mismatch_are_preserved(self):
        _, data = trial.load_archive(self.root)
        self.assertEqual(data, self.data)
        self.assertFalse(data['calls'][0]['source_duration_matches'])
        (self.folder / self.calls[0]['original_filename']).write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError, 'checksum'):
            trial.load_archive(self.root)

    def test_context_merge_requires_both_independent_passes_and_all_clips(self):
        self.make_passes()
        p = self.work / 'filtered.json'
        state = trial.read(p)
        state['clips'].pop(self.calls[0]['original_filename'])
        trial.write(p, state)
        with self.assertRaisesRegex(ValueError, 'Incomplete'):
            trial.merge(self.work, self.data, self.cfg, self.signature)
        self.assertFalse((self.work / 'passes.json').exists())
        self.assertEqual(trial.read(self.folder / 'calls.json'), self.data)

    def test_merge_is_candidates_only_and_rejects_mismatched_provenance(self):
        self.make_passes()
        trial.merge(self.work, self.data, self.cfg, self.signature)
        self.assertEqual(trial.read(self.folder / 'calls.json'), self.data)
        self.assertEqual(trial.read(self.work / 'summary.json')['publication_status'],
                         'awaiting_AI_reconciliation')
        p = self.work / 'context.json'
        state = trial.read(p)
        state['manifest_signature'] = 'wrong-audio'
        trial.write(p, state)
        with self.assertRaisesRegex(ValueError, 'mismatched'):
            trial.merge(self.work, self.data, self.cfg, self.signature)

    def test_finalize_preserves_metadata_and_never_sets_human_validation(self):
        self.make_passes()
        trial.merge(self.work, self.data, self.cfg, self.signature)
        self.make_review()
        trial.finalize(self.root, self.work / 'passes.json', self.work / 'reviewed.json')
        saved = trial.read(self.folder / 'calls.json')
        self.assertEqual(saved['coverage'], 'unknown')
        self.assertEqual(saved['coverage_note'], self.data['coverage_note'])
        for before, after in zip(self.calls, saved['calls']):
            self.assertEqual({k: v for k, v in after.items() if k != 'transcript'}, before)
            self.assertNotIn('validated', after)
        self.assertEqual(saved['calls'][1]['transcript'], '[unintelligible]')
        self.assertTrue(saved['enableTranscription'])
        self.assertFalse((self.folder / 'transcript.md').exists())
        before = (self.folder / 'calls.json').read_bytes()
        with self.assertRaisesRegex(ValueError, 'Existing transcript'):
            trial.finalize(self.root, self.work / 'passes.json', self.work / 'reviewed.json')
        self.assertEqual((self.folder / 'calls.json').read_bytes(), before)

    def test_unresolved_review_cannot_publish_clear_text_or_partially_mutate_file(self):
        self.make_passes()
        trial.merge(self.work, self.data, self.cfg, self.signature)
        review = self.make_review()
        review['entries'][1]['text'] = 'A confident assertion.'
        trial.write(self.work / 'reviewed.json', review)
        before = (self.folder / 'calls.json').read_bytes()
        with self.assertRaisesRegex(ValueError, 'Uncertainty'):
            trial.finalize(self.root, self.work / 'passes.json', self.work / 'reviewed.json')
        self.assertEqual((self.folder / 'calls.json').read_bytes(), before)


if __name__ == '__main__':
    unittest.main()
