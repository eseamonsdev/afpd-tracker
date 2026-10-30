import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from publish_radio_status import snapshot


class StatusTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        self.addCleanup(self.directory.cleanup)

    def write(self, path, data):
        target = self.root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(data))

    def rows(self, branch='staging'):
        with patch.dict(os.environ, {'RUNNER_TEMP': str(self.root), 'OPENMHZ_TARGET_BRANCH': 'staging'}):
            return {(r['date'], r['talkgroup']): r for r in snapshot(self.root, branch, 'idle')['rows']}

    def test_empty_collected_inventory_is_zero_not_unknown(self):
        self.write('records-pending-review/openmhz-metadata/6036/2026-10-14/calls.json',
                   {'date': '2026-10-14', 'talkgroup': 6036, 'calls': [], 'coverage': 'listing_traversed_no_independent_total'})
        rows = self.rows()
        self.assertEqual((rows['2026-10-14', 6036]['total'], rows['2026-10-14', 6036]['remaining']), (0, 0))
        self.assertTrue(rows['2026-10-14', 6036]['inventory_known'])
        self.assertIsNone(rows['2026-10-14', 6001]['total'])

    def test_calendar_gaps_and_all_talkgroups_are_present(self):
        for day in ['2026-10-13', '2026-10-15']:
            self.write(f'records-pending-review/openmhz-metadata/6036/{day}/calls.json',
                       {'date': day, 'talkgroup': 6036, 'calls': []})
        rows = self.rows()
        self.assertEqual(len(rows), 9)
        self.assertIsNone(rows['2026-10-14', 6036]['total'])

    def test_progress_is_branch_specific_and_failed_files_are_not_downloaded(self):
        self.write('radio-download-progress.json', {'clip': {'date': '2026-10-14', 'talkgroup': 5922,
                   'files': {'a.m4a': 'failed', 'b.m4a': 'downloaded'}}})
        row = self.rows()['2026-10-14', 5922]
        self.assertEqual((row['total'], row['downloaded'], row['failed'], row['remaining']), (2, 1, 1, 0))
        self.assertEqual(self.rows('main'), {})

    def test_saved_audio_clears_failure_and_preserves_unique_file_count(self):
        folder = 'openmhz-afpd-6036-2026-10-14'
        name = 'dcfems-6036-1792000000.m4a'
        call = {'original_filename': name, 'sha256': 'a' * 64, 'size_bytes': 100,
                'audio_storage': {'provider': 'r2', 'verified': True, 'bucket': 'test',
                                  'key': f'openmhz/{folder}/{name}', 'sha256': 'a' * 64, 'size_bytes': 100}}
        data = {'date': '2026-10-14', 'talkgroup': 6036, 'calls': [call, call]}
        self.write(f'public/records/openmhz/{folder}/calls.json', data)
        self.write('records-pending-review/openmhz-failures/test.json', data)
        row = self.rows()['2026-10-14', 6036]
        self.assertEqual((row['total'], row['saved'], row['failed'], row['remaining']), (1, 1, 0, 0))


if __name__ == '__main__':
    unittest.main()
