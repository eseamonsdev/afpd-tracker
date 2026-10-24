import importlib.util
import io
import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location('downloader', Path(__file__).parents[1] / 'scripts/download_openmhz_manifest.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def sample(epoch=1790755010, call_id='source-id'):
    name = f'dcfems-6001-{epoch}.m4a'
    return {'id': call_id, 'epoch': epoch, 'displayed_seconds': 3, 'talkgroup': 6001,
            'original_filename': name, 'media_url': f'https://media2.openmhz.com/media/dcfems/6001/{name}'}


def manifest(calls=None):
    calls = [sample()] if calls is None else calls
    return {'date': '2026-09-30', 'timezone': 'America/Denver', 'system': 'dcfems', 'talkgroup': 6001,
            'coverage': 'partial', 'collected_through_utc': '2026-09-30T18:00:00Z',
            'count': len(calls), 'calls': calls}


class DownloadTest(unittest.TestCase):
    def test_law2_import_uses_its_channel_folder_and_preserves_selection(self):
        call = sample()
        call.update(talkgroup=5922,
                    original_filename=call['original_filename'].replace('6001', '5922'),
                    media_url=call['media_url'].replace('6001', '5922'),
                    radio_ids=['14590021'])
        data = manifest([call])
        data['talkgroup'] = 5922
        data['selection_summary'] = {'context_seconds': 120, 'source_day_calls': 1}
        data['source_inventory'] = [call]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / '2026-09-30-law-2.json'
            source.write_text(json.dumps(data))
            downloader = Mock()
            downloader.download.side_effect = lambda url, dest: dest.write_bytes(b'0000ftyp0000')
            with patch.object(module, 'inspect_audio', return_value={
                    'sha256': 'test', 'size_bytes': 12, 'audio_duration_seconds': 3}):
                result = module.import_manifest(root, source, downloader)
            destination = root / 'public/records/openmhz/openmhz-afpd-law-2-2026-09-30'
            saved = json.loads((destination / 'calls.json').read_text())
            self.assertEqual(result['downloaded'], 1)
            self.assertEqual(saved['talkgroup'], 5922)
            self.assertEqual(saved['calls'][0]['talkgroup_name'], 'Law 2 Northeast')
            self.assertEqual(saved['calls'][0]['radio_ids'], ['14590021'])
            self.assertEqual(json.loads((destination / 'source-inventory.json').read_text()), [call])
            self.assertIn('Law 2 Northeast (5922)', (destination / 'README.txt').read_text())
            self.assertTrue((destination / 'rows.json').exists())
            self.assertFalse((root / 'public/records/openmhz/openmhz-afpd-car-to-car-2026-09-30').exists())
        data['talkgroup'] = 6001
        with self.assertRaises(ValueError):
            module.validate_manifest(data)
        data['talkgroup'] = 9999
        with self.assertRaises(ValueError):
            module.validate_manifest(data)

    def test_known_source_duration_discrepancy_requires_unchanged_measured_audio(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / sample()['original_filename']
            content = b'0000ftyp0000'
            path.write_bytes(content)
            call = sample()
            call['displayed_seconds'] = 9
            probe = Mock(stdout='1.408')
            with patch.object(module.subprocess, 'run', return_value=probe):
                with self.assertRaises(ValueError):
                    module.inspect_audio(path, call)
                call.update(sha256=hashlib.sha256(content).hexdigest(), audio_duration_seconds=1.408)
                self.assertFalse(module.inspect_audio(path, call)['source_duration_matches'])
                call['audio_duration_seconds'] = 9
                with self.assertRaises(ValueError):
                    module.inspect_audio(path, call)

    def test_complete_day_and_legacy_metadata(self):
        data = manifest()
        data.update(coverage='complete', collected_through_utc='2026-10-01T06:00:00Z')
        self.assertEqual(module.validate_manifest(data), data['date'])
        data['collected_through_utc'] = '2026-09-30T18:00:00Z'
        with self.assertRaises(ValueError):
            module.validate_manifest(data)
        data = manifest()
        del data['coverage']
        del data['collected_through_utc']
        self.assertEqual(module.validate_manifest(data), data['date'])
        self.assertEqual(module.coverage_metadata(data, data['date']), ('unknown', None))
        data['coverage'] = 'invalid'
        with self.assertRaises(ValueError):
            module.validate_manifest(data)

    def test_unfinished_complete_day_and_naive_cutoff_are_rejected(self):
        data = manifest()
        data['collected_through_utc'] = '2026-09-30T18:00:00'
        with self.assertRaises(ValueError):
            module.validate_manifest(data)
        with self.assertRaises(ValueError):
            module.coverage_metadata({'coverage': 'complete'}, '2999-01-01')

    def test_complete_day_boundaries_follow_daylight_saving(self):
        for day, hours in [('2025-03-09', 23), ('2025-11-02', 25)]:
            start, end = module.day_bounds(day)
            elapsed = end.timestamp() - start.timestamp()
            self.assertEqual(elapsed, hours * 3600)
            status, cutoff = module.coverage_metadata({'coverage': 'complete'}, day)
            self.assertEqual(status, 'complete')
            self.assertEqual(cutoff, end)

    def test_completion_upgrade_and_partial_rerun_do_not_redownload(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            destination = root / 'public/records/openmhz/openmhz-afpd-car-to-car-2026-09-30'
            destination.mkdir(parents=True)
            original = sample()
            (destination / original['original_filename']).write_bytes(b'0000ftyp0000')
            # Old ZIP archives can lack IDs and coverage metadata.
            old = manifest()
            del old['calls'][0]['id']
            del old['coverage']
            del old['collected_through_utc']
            (destination / 'calls.json').write_text(json.dumps(old))
            (destination / 'validation.json').write_text(json.dumps({'source_verification_file': 'source-verification.json'}))
            source = root / '2026-09-30.json'
            complete = manifest()
            complete.update(coverage='complete', collected_through_utc='2026-10-01T06:00:00Z')
            downloader = Mock()
            with patch.object(module, 'inspect_audio', return_value={'sha256': 'test', 'size_bytes': 12, 'audio_duration_seconds': 3}):
                for incoming in [complete, manifest()]:
                    source.write_text(json.dumps(incoming))
                    result = module.import_manifest(root, source, downloader)
                    self.assertEqual(result['downloaded'], 0)
                    self.assertEqual(result['skipped_existing'], 1)
                    saved = json.loads((destination / 'calls.json').read_text())
                    self.assertEqual(saved['coverage'], 'complete')
                    self.assertEqual(saved['collected_through_utc'], '2026-10-01T06:00:00Z')
                    self.assertEqual(saved['calls'][0]['id'], original['id'])
                    validation = json.loads((destination / 'validation.json').read_text())
                    self.assertEqual(validation['coverage'], saved['coverage'])
                    self.assertEqual(validation['schema_version'], 1)
                    self.assertEqual(validation['source_verification_file'], 'source-verification.json')
                    self.assertEqual(validation['timezone'], 'America/Denver')
                    self.assertEqual(saved['schema_version'], 1)
                    self.assertEqual(saved['source_call_count'], 1)
                    self.assertEqual(saved['calls'][0]['timestamp_utc'], '2026-09-30T07:56:50Z')
                    self.assertFalse((destination / 'rows.json').exists())
            downloader.download.assert_not_called()

    def test_failed_extension_does_not_replace_metadata(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            destination = root / 'public/records/openmhz/openmhz-afpd-car-to-car-2026-09-30'
            destination.mkdir(parents=True)
            original = sample()
            (destination / original['original_filename']).write_bytes(b'0000ftyp0000')
            originals = {'calls.json': json.dumps(manifest()), 'rows.json': '["saved row"]',
                         'validation.json': '{"validated":true}'}
            for name, text in originals.items():
                (destination / name).write_text(text)
            new = sample(1790755131, 'new-id')
            source = root / '2026-09-30.json'
            source.write_text(json.dumps(manifest([original, new])))
            downloader = Mock()
            downloader.download.side_effect = lambda url, dest: dest.write_bytes(b'0000ftyp0000')
            with patch.object(module, 'inspect_audio', side_effect=[{'size_bytes': 12, 'sha256': 'test', 'audio_duration_seconds': 3}, ValueError('Invalid audio')]):
                with self.assertRaises(ValueError):
                    module.import_manifest(root, source, downloader)
            for name, text in originals.items():
                self.assertEqual((destination / name).read_text(), text)
            self.assertFalse((destination / new['original_filename']).exists())

    def test_manifest_uses_mountain_date_and_cutoff(self):
        self.assertEqual(module.validate_manifest(manifest()), '2026-09-30')
        for field, value in [('epoch', 1790812800), ('talkgroup', 5922),
                             ('media_url', 'https://example.com/audio.m4a'),
                             ('original_filename', '../audio.m4a')]:
            data = manifest()
            data['calls'][0][field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                module.validate_manifest(data)
        data = manifest()
        data['collected_through_utc'] = '2026-09-30T06:00:00Z'
        with self.assertRaises(ValueError):
            module.validate_manifest(data)
        with self.assertRaises(ValueError):
            module.validate_manifest(manifest([sample(), sample()]))
        # 05:59 UTC is still the previous Mountain date.
        with self.assertRaises(ValueError):
            module.validate_manifest(manifest([sample(1790747940)]))

    def test_pause_is_measured_from_previous_attempt_completion(self):
        class Response(io.BytesIO):
            headers = {'Content-Type': 'audio/mp4'}
        downloader = module.Downloader()
        downloader.opener = Mock()
        downloader.opener.open.side_effect = [Response(b'0000ftyp0000'), Response(b'0000ftyp0000')]
        with tempfile.TemporaryDirectory() as directory, patch.object(module.time, 'monotonic', side_effect=[10, 10.5, 20]), patch.object(module.time, 'sleep') as sleep:
            downloader.download(sample()['media_url'], Path(directory) / 'one.m4a')
            downloader.download(sample()['media_url'], Path(directory) / 'two.m4a')
            sleep.assert_called_once_with(1.5)

    def test_html_response_is_not_saved_as_audio(self):
        class Response(io.BytesIO):
            headers = {'Content-Type': 'text/html'}
        downloader = module.Downloader()
        downloader.opener = Mock()
        downloader.opener.open.return_value = Response(b'<html>Denied</html>')
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'bad.m4a'
            with self.assertRaises(ValueError):
                downloader.download(sample()['media_url'], output)
            self.assertFalse(output.exists())

    def test_partial_day_extension_preserves_existing_calls(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            destination = root / 'public/records/openmhz/openmhz-afpd-car-to-car-2026-09-30'
            destination.mkdir(parents=True)
            original = sample()
            (destination / original['original_filename']).write_bytes(b'0000ftyp0000')
            (destination / 'calls.json').write_text(json.dumps(manifest()))
            new = sample(1790755131, 'new-id')
            source = root / '2026-09-30.json'
            source.write_text(json.dumps(manifest([new])))
            downloader = Mock()
            downloader.download.side_effect = lambda url, dest: dest.write_bytes(b'0000ftyp0000')
            with patch.object(module, 'inspect_audio', return_value={'sha256': 'test', 'size_bytes': 12, 'audio_duration_seconds': 3}):
                result = module.import_manifest(root, source, downloader)
            saved = json.loads((destination / 'calls.json').read_text())
            self.assertEqual({c['id'] for c in saved['calls']}, {'source-id', 'new-id'})
            self.assertEqual(result['downloaded'], 1)
            self.assertEqual(saved['coverage'], 'partial')


if __name__ == '__main__':
    unittest.main()
