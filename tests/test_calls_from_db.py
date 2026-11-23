import importlib.util
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'db/calls_from_db.py'
spec = importlib.util.spec_from_file_location('calls_from_db', SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ReconcileTests(unittest.TestCase):
    def test_updates_only_transcript_fields_and_rejects_missing_clip_before_writing(self):
        with tempfile.TemporaryDirectory(dir=module.ROOT) as directory:
            archives = Path(directory)
            path = archives / 'calls.json'
            content = {'calls': [{'id': 'one', 'note': 'keep', 'transcript': 'old', 'validated': False}]}
            path.write_text(json.dumps(content), encoding='utf-8')
            relative = path.relative_to(module.ROOT).as_posix()
            with sqlite3.connect(':memory:') as connection:
                connection.execute('CREATE TABLE radio_clips (id TEXT, archive_path TEXT, transcript TEXT, transcript_validated INTEGER)')
                connection.execute('INSERT INTO radio_clips VALUES (?, ?, ?, ?)', ('one', relative, 'new', 1))
                module.reconcile(connection, archives)
                self.assertEqual(json.loads(path.read_text()), {'calls': [
                    {'id': 'one', 'note': 'keep', 'transcript': 'new', 'validated': True}]})
                connection.execute('INSERT INTO radio_clips VALUES (?, ?, ?, ?)', ('missing', relative, 'text', 0))
                with self.assertRaises(ValueError):
                    module.reconcile(connection, archives)


if __name__ == '__main__':
    unittest.main()
