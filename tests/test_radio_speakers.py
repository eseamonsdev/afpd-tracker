import json
import math
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from group_radio_voices import cluster_vectors, positive, select_days, similarity_threshold, write_reports, publish_result


class SpeakerGroupingTests(unittest.TestCase):
    def test_r2_output_is_scoped_and_readback_verified(self):
        import hashlib
        from unittest.mock import Mock, patch
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            path = root / 'voice-recognition/6001/2026-11-02/voices.json'
            path.parent.mkdir(parents=True)
            path.write_text(json.dumps({'date': '2026-11-02', 'talkgroup': 6001}))
            client = Mock()
            with patch('group_radio_voices.ROOT', root), \
                 patch('r2_audio.client_and_bucket', return_value=(client, 'afpd-public-media')), \
                 patch('r2_audio.read_verified') as verify:
                publish_result(path)
                upload = client.put_object.call_args.kwargs
                self.assertEqual(upload['Key'], 'voice-recognition/6001/2026-11-02/voices.json')
                self.assertEqual(upload['ContentType'], 'application/json')
                verify.assert_called_once_with(client, 'afpd-public-media', upload['Key'],
                    hashlib.sha256(path.read_bytes()).hexdigest(), len(path.read_bytes()))
                with self.assertRaises(ValueError):
                    publish_result(root / 'openmhz/voices.json')
                path.write_text(json.dumps({'date': '2026-11-01', 'talkgroup': 6001}))
                with self.assertRaises(ValueError):
                    publish_result(path)
                self.assertEqual(client.put_object.call_count, 1)

    def test_dates_are_selected_exactly_and_only_from_6001(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for day in ['2026-11-01', '2026-11-02']:
                path = root / 'public/records/openmhz' / f'openmhz-afpd-car-to-car-{day}' / 'calls.json'
                path.parent.mkdir(parents=True)
                path.write_text(json.dumps({'date': day, 'talkgroup': 6001}))
            self.assertEqual(select_days(root, 'all'), ['2026-11-01', '2026-11-02'])
            self.assertEqual(select_days(root, '2026-11-02,2026-11-02'), ['2026-11-02'])
            with self.assertRaises(ValueError):
                select_days(root, '2026-11-03')
            with self.assertRaises(ValueError):
                select_days(root, '../../bad')

    def test_distinct_voices_and_empty_input(self):
        self.assertEqual(cluster_vectors([], .75), [])
        self.assertEqual(cluster_vectors([[1, 0]], .75), [1])
        self.assertEqual(cluster_vectors([[1, 0], [0, 1], [2, .01]], .75), [1, 2, 1])

    def test_complete_linkage_prevents_chain_merges(self):
        # A resembles B and B resembles C; A does not resemble C.
        vectors = [[math.cos(a), math.sin(a)] for a in [0, .5, 1]]
        labels = cluster_vectors(vectors, .8)
        self.assertNotEqual(labels[0], labels[2])

    def test_invalid_parameters_and_embeddings(self):
        for value in [0, -1, float('nan'), float('inf')]:
            with self.assertRaises(ValueError):
                positive(value)
        for value in [0, 1, float('nan')]:
            with self.assertRaises(ValueError):
                similarity_threshold(value)
        with self.assertRaises(ValueError):
            cluster_vectors([[0, 0]], .75)

    def test_reports_keep_original_numbers_and_radio_metadata(self):
        with tempfile.TemporaryDirectory() as tmp:
            result = {'date': '2026-11-02', 'min_speech_seconds': 3,
                      'similarity_threshold': .75, 'groups': [{'voice': 'Voice 001', 'clip_numbers': [2, 8]}],
                      'clips': [{'clip_number': 1, 'status': 'skipped_short_speech', 'radio_ids': [36]},
                                {'clip_number': 2, 'status': 'embedded', 'radio_ids': [42]},
                                {'clip_number': 8, 'status': 'embedded', 'radio_ids': [36]}]}
            write_reports(Path(tmp), result, [[1, 0], [1, .01]])
            import numpy as np
            with np.load(Path(tmp) / 'embeddings.npz') as saved:
                self.assertEqual(saved['clip_numbers'].tolist(), [2, 8])
            self.assertIn('Voice 001 | 2, 8', (Path(tmp) / 'report.md').read_text())
            self.assertEqual(json.loads((Path(tmp) / 'voices.json').read_text())['clips'][2]['radio_ids'], [36])


if __name__ == '__main__':
    unittest.main()
