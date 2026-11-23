import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'db'))
from upload_d1 import SCHEMAS, load_policy, write_import  # noqa: E402


class UploadImportTests(unittest.TestCase):
    def test_empty_and_existing_database_with_circular_officer_names(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'source.sqlite'
            output = Path(directory) / 'import.sql'
            with sqlite3.connect(source) as connection:
                connection.execute('PRAGMA foreign_keys=ON')
                for migration in SCHEMAS:
                    connection.executescript(migration.read_text(encoding='utf-8'))
                connection.execute("INSERT INTO officers VALUES (1, 'officer-1', 'officer-1', NULL)")
                connection.execute("""INSERT INTO officer_names
                    (id, officer_id, name_text, kind, source_path, source_fields)
                    VALUES (2, 1, 'Officer One', 'personal_name', 'fixture', 'name')""")
                connection.execute('UPDATE officers SET display_name_id=2 WHERE id=1')
                connection.commit()
            write_import(source, output, load_policy())
            with sqlite3.connect(':memory:') as target:
                target.execute('PRAGMA foreign_keys=ON')
                sql = output.read_text(encoding='utf-8')
                target.executescript(sql)
                target.executescript(sql)
                self.assertEqual(target.execute('SELECT display_name_id FROM officers').fetchone(), (2,))
                self.assertEqual(target.execute('PRAGMA foreign_key_check').fetchall(), [])


if __name__ == '__main__':
    unittest.main()
