import json
from pathlib import Path
import sys
import tempfile
import unittest
from urllib.error import HTTPError

sys.path.insert(0, str(Path(__file__).parents[1] / 'scripts'))
from prepare_radio_day import prepare
from download_openmhz_manifest import import_manifest


def call(index, error):
    epoch = 1793379525 + index
    name = f'dcfems-5922-{epoch}.m4a'
    return dict(id=f'call-{index}', epoch=epoch, displayed_seconds=1,
                talkgroup=5922, original_filename=name,
                media_url=f'https://media2.openmhz.com/media/dcfems/5922/{name}',
                download_error=error)


class RateLimitRetryTests(unittest.TestCase):
    def test_prepare_requeues_legacy_429_but_keeps_other_failures(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            calls = [call(0, 'HTTPError: HTTP Error 429: Too Many Requests'),
                     call(1, 'HTTPError: HTTP Error 403: Forbidden')]
            data = dict(date='2026-10-30', talkgroup=5922, count=2, calls=calls)
            metadata = root / 'records-pending-review/openmhz-metadata/law-2/2026-10-30/calls.json'
            metadata.parent.mkdir(parents=True)
            metadata.write_text(json.dumps(data))
            failure = root / 'records-pending-review/openmhz-failures/2026-10-30-law-2.json'
            failure.parent.mkdir(parents=True)
            failure.write_text(json.dumps(data))
            result = prepare(root, '2026-10-30', 5922)
            self.assertEqual(result['queued'], 1)
            self.assertEqual(result['known_failures_not_retried'], 1)
            self.assertEqual(json.loads(failure.read_text())['calls'][0]['id'], 'call-1')
            queued = root / 'records-pending-review/openmhz-manifests' / result['manifest']
            self.assertEqual(json.loads(queued.read_text())['calls'][0]['id'], 'call-0')

    def test_new_429_stops_before_next_clip_without_failure_record(self):
        class LimitedDownloader:
            attempts = 0
            def download(self, url, destination):
                self.attempts += 1
                raise HTTPError(url, 429, 'Too Many Requests', {}, None)
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / '2026-10-30-law-2.json'
            source.write_text(json.dumps(dict(date='2026-10-30', timezone='America/Denver',
                system='dcfems', talkgroup=5922, count=2, calls=[call(0, ''), call(1, '')])))
            downloader = LimitedDownloader()
            result = import_manifest(root, source, downloader, pause_ms=2000)
            self.assertTrue(result['rate_limited'])
            self.assertEqual(result['processed'], 0)
            self.assertEqual(result['failed'], 0)
            self.assertEqual(downloader.attempts, 1)
            self.assertFalse((root / 'records-pending-review/openmhz-failures/2026-10-30-law-2.json').exists())


if __name__ == '__main__':
    unittest.main()
