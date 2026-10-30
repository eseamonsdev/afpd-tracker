import importlib.util
import io
import hashlib
import json
import tempfile
import unittest
import sys
from pathlib import Path
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).parents[1] / 'scripts'))

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
    def test_new_request_preserves_verified_r2_audio_without_fetching_or_inspecting_it(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            folder = root / 'public/records/openmhz/openmhz-afpd-car-to-car-2026-09-30'
            folder.mkdir(parents=True)
            old = module.normalize_call_metadata(sample(), '2026-09-30')
            old.update(sha256='a' * 64, size_bytes=12, audio_duration_seconds=3,
                       source_duration_matches=True, audio_downloaded=True,
                       transcript='Owner wording', transcript_original='Original wording',
                       validated=True, note='Preserve this')
            old['audio_storage'] = {'provider': 'r2', 'verified': True, 'bucket': 'bucket',
                                    'key': f'openmhz/{folder.name}/{old["original_filename"]}',
                                    'sha256': old['sha256'], 'size_bytes': 12}
            (folder / 'calls.json').write_text(json.dumps(manifest([old])))
            new = sample(old['epoch'] + 10, 'new-call')
            source = root / '2026-09-30.json'
            source.write_text(json.dumps(manifest([new])))
            downloader = Mock()
            downloader.download.side_effect = lambda url, path: path.write_bytes(b'0000ftyp0000')
            checked = {'sha256': 'b' * 64, 'size_bytes': 12, 'audio_duration_seconds': 3}
            with patch.object(module, 'inspect_audio', return_value=checked) as inspect, \
                 patch('r2_audio.read_verified', side_effect=AssertionError('Old R2 audio must not be fetched')):
                result = module.import_manifest(root, source, downloader, pause_ms=500)
            downloader.download.assert_called_once_with(new['media_url'], unittest.mock.ANY)
            self.assertEqual(inspect.call_count, 1)
            self.assertEqual(result['downloaded'], 1)
            saved = json.loads((folder / 'calls.json').read_text())
            self.assertEqual(saved['calls'][0], old)
            self.assertFalse((folder / old['original_filename']).exists())
            validation = json.loads((folder / 'validation.json').read_text())
            self.assertTrue(validation['validated'])
            self.assertEqual(validation['audio_validated_count'], 2)
            self.assertEqual(validation['minimum_pause_after_download_seconds'], 0.5)
            # Model the intervening publication of the newly downloaded file.
            saved['calls'][1]['audio_storage'] = {
                'provider': 'r2', 'verified': True, 'bucket': 'bucket',
                'key': f'openmhz/{folder.name}/{new["original_filename"]}',
                'sha256': checked['sha256'], 'size_bytes': checked['size_bytes']}
            (folder / 'calls.json').write_text(json.dumps(saved))
            # Requesting an existing verified recording also skips all audio IO.
            source.write_text(json.dumps(manifest([old])))
            with patch.object(module, 'inspect_audio', side_effect=AssertionError('No reinspection')):
                result = module.import_manifest(root, source, downloader)
            self.assertEqual(result['skipped_existing'], 1)
            self.assertEqual(downloader.download.call_count, 1)

    def test_custom_millisecond_pause_is_honored(self):
        class Response(io.BytesIO):
            headers = {'Content-Type': 'audio/mp4'}
        downloader = module.Downloader(pause_ms=250)
        downloader.opener = Mock()
        downloader.opener.open.side_effect = [Response(b'0000ftyp0000'), Response(b'0000ftyp0000')]
        with tempfile.TemporaryDirectory() as directory, \
             patch.object(module.time, 'monotonic', side_effect=[10, 10.1, 20]), \
             patch.object(module.time, 'sleep') as sleep:
            downloader.download(sample()['media_url'], Path(directory) / 'one.m4a')
            downloader.download(sample()['media_url'], Path(directory) / 'two.m4a')
            self.assertAlmostEqual(sleep.call_args.args[0], 0.15)

    def test_first_download_accepts_listing_only_or_empty_folder(self):
        for listing in (False, True):
            with self.subTest(listing=listing), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                folder = root / 'public/records/openmhz/openmhz-afpd-car-to-car-2026-09-30'
                folder.mkdir(parents=True)
                if listing:
                    (folder / 'openmhz-listing.json').write_text('{"preserved": true}')
                source = root / '2026-09-30.json'
                source.write_text(json.dumps(manifest()))
                downloader = Mock()
                downloader.download.side_effect = lambda url, dest: dest.write_bytes(b'0000ftyp0000')
                with patch.object(module, 'inspect_audio', return_value={
                        'sha256': 'test', 'size_bytes': 12, 'audio_duration_seconds': 3}):
                    result = module.import_manifest(root, source, downloader)
                self.assertEqual(result['downloaded'], 1)
                self.assertEqual(json.loads((folder / 'calls.json').read_text())['count'], 1)
                if listing:
                    self.assertEqual((folder / 'openmhz-listing.json').read_text(), '{"preserved": true}')

    def test_folder_without_manifest_rejects_untracked_files(self):
        for name in (sample()['original_filename'], 'validation.json'):
            with self.subTest(name=name), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                folder = root / 'public/records/openmhz/openmhz-afpd-car-to-car-2026-09-30'
                folder.mkdir(parents=True)
                (folder / name).write_text('preserve me')
                source = root / '2026-09-30.json'
                source.write_text(json.dumps(manifest()))
                downloader = Mock()
                with self.assertRaisesRegex(ValueError, 'Existing archive folder has no manifest'):
                    module.import_manifest(root, source, downloader)
                downloader.download.assert_not_called()
                self.assertEqual((folder / name).read_text(), 'preserve me')

    def test_metadata_inventory_survives_checkpoints_failures_and_resume(self):
        calls = [sample(1790755010 + i * 10, f'id-{i}') for i in range(3)]
        for i, call in enumerate(calls):
            call.update(radio_ids=[str(14590000 + i)], audio_downloaded=False)
        duplicate = {**calls[2], 'id': 'duplicate-source'}
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            folder = root / 'public/records/openmhz/openmhz-afpd-car-to-car-2026-09-30'
            folder.mkdir(parents=True)
            old = {**manifest(calls), 'duplicate_source_calls': [duplicate]}
            (folder / 'calls.json').write_text(json.dumps(old))
            source = root / '2026-09-30.json'
            downloader = Mock()
            def download(url, dest):
                if url == calls[1]['media_url']:
                    raise OSError('unavailable')
                dest.write_bytes(b'0000ftyp0000')
            downloader.download.side_effect = download
            checked = {'sha256': 'test', 'size_bytes': 12, 'audio_duration_seconds': 3}
            with patch.object(module, 'inspect_audio', return_value=checked):
                source.write_text(json.dumps(manifest(calls[:2])))
                result = module.import_manifest(root, source, downloader)
                self.assertEqual((result['downloaded'], result['failed']), (1, 1))
                saved = json.loads((folder / 'calls.json').read_text())
                self.assertEqual(saved['count'], 3)
                self.assertEqual([c['radio_ids'] for c in saved['calls']], [c['radio_ids'] for c in calls])
                self.assertEqual(saved['duplicate_source_calls'][0]['id'], 'duplicate-source')
                validation = json.loads((folder / 'validation.json').read_text())
                self.assertFalse(validation['validated'])
                self.assertEqual(validation['audio_pending_count'], 2)
                source.write_text(json.dumps(manifest(calls[2:])))
                module.import_manifest(root, source, downloader)
            saved = json.loads((folder / 'calls.json').read_text())
            self.assertEqual(saved['count'], 3)
            self.assertEqual([c['audio_downloaded'] for c in saved['calls']], [True, False, True])
            self.assertTrue(saved['duplicate_source_calls'][0]['audio_downloaded'])
            self.assertEqual(saved['download_failure_count'], 1)
            self.assertEqual(downloader.download.call_count, 3)

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

    def test_source_duration_mismatch_uses_actual_duration_after_full_decode(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / sample()['original_filename']
            path.write_bytes(b'0000ftyp0000')
            call = {**sample(), 'displayed_seconds': 9}
            with patch.object(module.subprocess, 'run', side_effect=[Mock(stdout='1.408'), Mock()]) as run:
                result = module.inspect_audio(path, call)
            self.assertEqual(result['audio_duration_seconds'], 1.408)
            self.assertFalse(result['source_duration_matches'])
            self.assertEqual(call['displayed_seconds'], 9)
            self.assertEqual(run.call_args.args[0][0], 'ffmpeg')
            self.assertIn('-xerror', run.call_args.args[0])

    def test_duration_mismatch_does_not_accept_decode_errors(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / sample()['original_filename']
            path.write_bytes(b'0000ftyp0000')
            failure = module.subprocess.CalledProcessError(1, 'ffmpeg')
            with patch.object(module.subprocess, 'run', side_effect=[Mock(stdout='1.408'), failure]):
                with self.assertRaises(module.subprocess.CalledProcessError):
                    module.inspect_audio(path, {**sample(), 'displayed_seconds': 9})

    def test_source_duration_policy_preserves_checksum_and_positive_duration_checks(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / sample()['original_filename']
            path.write_bytes(b'0000ftyp0000')
            with self.assertRaisesRegex(ValueError, 'checksum mismatch'):
                module.inspect_audio(path, {**sample(), 'sha256': 'a' * 64})
            for duration in ['0', '-1', 'nan', 'inf']:
                with self.subTest(duration=duration), patch.object(module.subprocess, 'run', return_value=Mock(stdout=duration)):
                    with self.assertRaises(ValueError):
                        module.inspect_audio(path, sample())

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

    def test_failure_continues_and_retains_only_failed_calls_for_retry(self):
        calls = [sample(1790755010 + i * 10, f'id-{i}') for i in range(3)]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / '2026-09-30.json'
            source.write_text(json.dumps(manifest(calls)))
            downloader = Mock()
            def download(url, dest):
                if url == calls[1]['media_url']:
                    raise OSError('connection lost')
                dest.write_bytes(b'0000ftyp0000')
            downloader.download.side_effect = download
            with patch.object(module, 'inspect_audio', return_value={'sha256': 'test', 'size_bytes': 12, 'audio_duration_seconds': 3}):
                result = module.import_manifest(root, source, downloader)
            self.assertEqual(downloader.download.call_count, 3)
            self.assertEqual(result['downloaded'], 2)
            self.assertEqual(result['failed'], 1)
            folder = root / 'public/records/openmhz/openmhz-afpd-car-to-car-2026-09-30'
            saved = json.loads((folder / 'calls.json').read_text())
            self.assertEqual([c['id'] for c in saved['calls']], ['id-0', 'id-2'])
            self.assertEqual(saved['coverage'], 'unknown')
            failure = root / 'records-pending-review/openmhz-failures/2026-09-30-car-to-car.json'
            retry = json.loads(failure.read_text())
            self.assertEqual([c['id'] for c in retry['calls']], ['id-1'])
            self.assertEqual(module.validate_manifest(retry), '2026-09-30')
            source.write_text(json.dumps(retry))
            downloader.download.side_effect = lambda url, dest: dest.write_bytes(b'0000ftyp0000')
            with patch.object(module, 'inspect_audio', return_value={'sha256': 'test', 'size_bytes': 12, 'audio_duration_seconds': 3}):
                module.import_manifest(root, source, downloader)
            self.assertFalse(failure.exists())
            self.assertEqual(len(json.loads((folder / 'calls.json').read_text())['calls']), 3)

    def test_bad_audio_is_not_published_and_same_filename_is_not_retried(self):
        calls = [sample(), sample(call_id='same-audio'), sample(1790755131, 'later')]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / '2026-09-30.json'
            source.write_text(json.dumps(manifest(calls)))
            downloader = Mock()
            downloader.download.side_effect = lambda url, dest: dest.write_bytes(b'bad audio')
            def inspect(path, call):
                if call['epoch'] == calls[0]['epoch']:
                    raise ValueError('Invalid audio')
                return {'sha256': 'test', 'size_bytes': 12, 'audio_duration_seconds': 3}
            with patch.object(module, 'inspect_audio', side_effect=inspect):
                result = module.import_manifest(root, source, downloader)
            self.assertEqual(downloader.download.call_count, 2)
            self.assertEqual(result['failed'], 2)
            folder = root / 'public/records/openmhz/openmhz-afpd-car-to-car-2026-09-30'
            self.assertFalse((folder / calls[0]['original_filename']).exists())
            self.assertTrue((folder / calls[2]['original_filename']).exists())

    def test_main_checkpoints_300_and_resumes_remaining_calls(self):
        calls = [sample(1790755010 + i * 10, f'id-{i}') for i in range(303)]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            pending = root / 'records-pending-review/openmhz-manifests'
            pending.mkdir(parents=True)
            source = pending / '2026-09-30.json'
            source.write_text(json.dumps(manifest(calls)))
            downloader = Mock()
            downloader.download.side_effect = lambda url, dest: dest.write_bytes(b'0000ftyp0000')
            args = ['download', '--root', str(root), '--summary', str(root / 'summary.json')]
            with patch('sys.argv', args), patch.object(module, 'Downloader', return_value=downloader), patch.object(module, 'inspect_audio', return_value={'sha256': 'test', 'size_bytes': 12, 'audio_duration_seconds': 3}), patch.object(module.subprocess, 'run'):
                module.main()
                self.assertEqual(downloader.download.call_count, 300)
                self.assertEqual(json.loads(source.read_text())['count'], 3)
                module.main()
                self.assertEqual(downloader.download.call_count, 303)
            self.assertFalse(source.exists())

    def test_selected_manifest_leaves_other_queued_day_untouched(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            pending = root / 'records-pending-review/openmhz-manifests'
            pending.mkdir(parents=True)
            source = pending / '2026-09-30.json'
            source.write_text(json.dumps(manifest()))
            other = pending / '2026-10-01-law-2.json'
            other.write_text('not even parsed by this day job')
            downloader = Mock()
            downloader.download.side_effect = OSError('unavailable')
            args = ['download', '--root', str(root), '--summary', str(root / 'summary.json'),
                    '--manifest', source.name]
            with patch('sys.argv', args), patch.object(module, 'Downloader', return_value=downloader), patch.object(module.subprocess, 'run'):
                module.main()
            self.assertFalse(source.exists())
            self.assertEqual(other.read_text(), 'not even parsed by this day job')
            downloader.download.assert_called_once()

    def test_all_failed_batch_is_removed_from_queue_but_kept_for_manual_retry(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            pending = root / 'records-pending-review/openmhz-manifests'
            pending.mkdir(parents=True)
            source = pending / '2026-09-30.json'
            source.write_text(json.dumps(manifest()))
            downloader = Mock()
            downloader.download.side_effect = OSError('unavailable')
            with patch('sys.argv', ['download', '--root', str(root), '--summary', str(root / 'summary.json')]), patch.object(module, 'Downloader', return_value=downloader), patch.object(module.subprocess, 'run'):
                module.main()
            self.assertFalse(source.exists())
            self.assertFalse((root / 'public/records/openmhz/openmhz-afpd-car-to-car-2026-09-30').exists())
            self.assertTrue((root / 'records-pending-review/openmhz-failures/2026-09-30-car-to-car.json').exists())
            downloader.download.assert_called_once()

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
        with tempfile.TemporaryDirectory() as directory, patch.object(module.time, 'monotonic', side_effect=[10, 10.25, 20]), patch.object(module.time, 'sleep') as sleep:
            downloader.download(sample()['media_url'], Path(directory) / 'one.m4a')
            downloader.download(sample()['media_url'], Path(directory) / 'two.m4a')
            sleep.assert_called_once_with(0.75)

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

    def test_failed_download_also_keeps_default_pause_before_next_attempt(self):
        class Response(io.BytesIO):
            headers = {'Content-Type': 'audio/mp4'}
        downloader = module.Downloader()
        downloader.opener = Mock()
        downloader.opener.open.side_effect = [OSError('connection lost'), Response(b'0000ftyp0000')]
        with tempfile.TemporaryDirectory() as directory, \
             patch.object(module.time, 'monotonic', side_effect=[10, 10.1, 20]), \
             patch.object(module.time, 'sleep') as sleep:
            with self.assertRaises(OSError):
                downloader.download(sample()['media_url'], Path(directory) / 'failed.m4a')
            downloader.download(sample()['media_url'], Path(directory) / 'next.m4a')
            self.assertAlmostEqual(sleep.call_args.args[0], 0.9)

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
