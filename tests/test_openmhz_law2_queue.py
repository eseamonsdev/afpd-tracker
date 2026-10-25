import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1] / 'scripts'))
from prepare_law2_day import prepare


class Law2QueueTest(unittest.TestCase):
    def test_prepare_skips_saved_and_failed_and_resumes_checkpoint(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            calls = []
            for i in range(3):
                epoch = 1790920819 + i
                name = f'dcfems-5922-{epoch}.m4a'
                calls.append({'id': f'id-{i}', 'epoch': epoch, 'displayed_seconds': 3,
                              'talkgroup': 5922, 'original_filename': name,
                              'media_url': f'https://media2.openmhz.com/media/dcfems/5922/{name}'})
            source = root / 'records-pending-review/openmhz-metadata/law-2/2026-10-02/calls.json'
            source.parent.mkdir(parents=True)
            source.write_text(json.dumps({'date': '2026-10-02', 'talkgroup': 5922,
                                          'count': 3, 'calls': calls}))
            archive = root / 'public/records/openmhz/openmhz-afpd-law-2-2026-10-02'
            archive.mkdir(parents=True)
            (archive / 'calls.json').write_text(json.dumps({'calls': calls[:1]}))
            (archive / calls[0]['original_filename']).write_bytes(b'archived')
            failure = root / 'records-pending-review/openmhz-failures/2026-10-02-law-2.json'
            failure.parent.mkdir(parents=True)
            failure.write_text(json.dumps({'calls': calls[1:2]}))
            result = prepare(root, '2026-10-02')
            self.assertEqual(result['queued'], 1)
            queue = root / 'records-pending-review/openmhz-manifests/2026-10-02-law-2.json'
            self.assertEqual(json.loads(queue.read_text())['calls'], calls[2:])
            self.assertTrue(prepare(root, '2026-10-02')['resuming'])
            self.assertEqual(json.loads(queue.read_text())['count'], 1)

    def test_trial_refuses_dates_outside_authorized_range(self):
        for day in ('2026-10-01', '2026-10-16'):
            with self.assertRaises(ValueError):
                prepare(Path('/unused'), day)
