import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).parents[1] / 'scripts'
sys.path.insert(0, str(SCRIPTS))
spec = importlib.util.spec_from_file_location('metadata', SCRIPTS / 'normalize_openmhz_metadata.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class MetadataTest(unittest.TestCase):
    def test_normalization_uses_source_link_and_preserves_legacy_rows(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            name = 'dcfems-6001-1790755010.m4a'
            audio = b'0000ftyp0000'
            (folder / name).write_bytes(audio)
            call = {'epoch': 1790755010, 'displayed_seconds': 3, 'talkgroup': 6001,
                    'original_filename': name, 'media_url': f'https://media2.openmhz.com/media/dcfems/6001/{name}',
                    'call_link': 'https://openmhz.com/system/dcfems?call-id=original-id',
                    'radio_metadata_source_call_id': 'alternate-metadata-id', 'row': 'original source row',
                    'audio_duration_seconds': 3}
            (folder / 'calls.json').write_text(json.dumps({'date': '2026-09-30', 'calls': [call]}))
            (folder / 'rows.json').write_text('["original inventory order"]')
            (folder / 'validation.json').write_text('{"historic_evidence":true}')
            files = module.standardized_files(folder)
            self.assertEqual(files['calls.json']['calls'][0]['id'], 'original-id')
            self.assertEqual(files['calls.json']['coverage'], 'unknown')
            self.assertIsNone(files['calls.json']['collected_through_utc'])
            self.assertEqual(files['legacy-rows.json'], ['original inventory order'])
            self.assertTrue(files['validation.json']['historic_evidence'])
            self.assertIsNone(files['validation.json']['downloaded'])
            self.assertEqual((folder / name).read_bytes(), audio)

    def test_changed_audio_cannot_reuse_saved_validation(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            name = 'dcfems-6001-1790755010.m4a'
            (folder / name).write_bytes(b'0000ftyp0000')
            call = {'id': 'id', 'epoch': 1790755010, 'displayed_seconds': 3, 'talkgroup': 6001,
                    'original_filename': name, 'media_url': f'https://media2.openmhz.com/media/dcfems/6001/{name}',
                    'audio_duration_seconds': 3, 'sha256': 'wrong'}
            (folder / 'calls.json').write_text(json.dumps({'date': '2026-09-30', 'calls': [call]}))
            with self.assertRaisesRegex(ValueError, 'checksum mismatch'):
                module.standardized_files(folder)
