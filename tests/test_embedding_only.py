import copy
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from group_radio_voices import write_embedding_reports, compare_embeddings, publish_result
from reorganize_voice_storage import embedding_result, split_result
from test_voice_storage import MemoryR2, sample


class EmbeddingOnlyTests(unittest.TestCase):
    def test_extraction_has_no_comparison_settings_or_group_labels(self):
        data = sample()
        objects = embedding_result(data)
        self.assertEqual(len(objects), 1)
        key, content = next(iter(objects.items()))
        self.assertIn('/embeddings/', key)
        result = json.loads(content)
        for field in ['groups', 'clustering', 'similarity_threshold']:
            self.assertNotIn(field, result)
        self.assertTrue(all('voice' not in c for c in result['clips']))
        data['run_counts'] = dict(reused_embeddings=2, new_embeddings=0, errors=0)
        with tempfile.TemporaryDirectory() as tmp, patch('group_radio_voices.cluster_vectors', side_effect=AssertionError('Comparison during extraction')):
            write_embedding_reports(Path(tmp), data, [[1, 0], [1, 0]])
            self.assertFalse((Path(tmp) / 'voices.json').exists())
            self.assertEqual((Path(tmp) / 'embeddings.json').read_bytes(), content)

    def test_embedding_publication_leaves_existing_comparisons_untouched(self):
        data = sample()
        client = MemoryR2(split_result(data))
        before = copy.deepcopy(client.objects)
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            path = root / 'voice-recognition/6001' / data['date'] / 'embeddings.json'
            path.parent.mkdir(parents=True)
            path.write_bytes(next(iter(embedding_result(data).values())))
            with patch('group_radio_voices.ROOT', root), patch('r2_audio.client_and_bucket', return_value=(client, 'bucket')):
                publish_result(path, embeddings_only=True)
        self.assertEqual(client.objects, before)
        self.assertEqual(client.writes, 0)

    def test_manual_comparison_uses_saved_vectors_and_writes_only_comparisons(self):
        data = sample()
        objects = embedding_result(data)
        client = MemoryR2(objects)
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / 'embeddings.json'
            original = next(iter(objects.values()))
            source.write_bytes(original)
            args = SimpleNamespace(embeddings=source, output=Path(tmp) / 'comparison', threshold=.7, publish=True)
            with patch('r2_audio.client_and_bucket', return_value=(client, 'bucket')):
                compare_embeddings(args)
            self.assertEqual(source.read_bytes(), original)
            result = json.loads((args.output / 'groups.json').read_bytes())
            self.assertTrue(result['groups'])
            self.assertNotIn('embedding', result['clips'][0])
            import hashlib
            self.assertEqual(result['embeddings_sha256'], hashlib.sha256(original).hexdigest())
        for key, content in objects.items():
            self.assertEqual(client.objects[key], content)
        self.assertEqual(client.writes, 1)


if __name__ == '__main__':
    unittest.main()
