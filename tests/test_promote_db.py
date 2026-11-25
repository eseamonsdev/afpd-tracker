import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'db'))
from promote_db import SOURCE, TARGET, fingerprint, prepare_promotion, promote, user_schema


def fixture():
    db = sqlite3.connect(':memory:')
    db.executescript("""
        CREATE TABLE officers (id INTEGER PRIMARY KEY, display_name_id INTEGER REFERENCES officer_names(id));
        CREATE TABLE officer_names (id INTEGER PRIMARY KEY, officer_id INTEGER REFERENCES officers(id), name_text TEXT);
        CREATE TABLE radio_clips (id TEXT PRIMARY KEY, transcript TEXT, transcript_validated INTEGER);
        INSERT INTO officers VALUES (1,10);
        INSERT INTO officer_names VALUES (10,1,'Officer One');
        INSERT INTO radio_clips VALUES ('clip1','Yes, I can.',1);
        CREATE TABLE serials (id INTEGER PRIMARY KEY AUTOINCREMENT, value TEXT);
        INSERT INTO serials VALUES (1,'kept'),(10,'deleted');
        DELETE FROM serials WHERE id=10;
        CREATE INDEX by_name ON officer_names(name_text);
        CREATE VIEW clip_text AS SELECT transcript FROM radio_clips;
    """)
    db.executescript((ROOT / 'db/migrations/0007_association_evidence.sql').read_text())
    db.executescript("""
        INSERT INTO radio_associations VALUES ('a','officer-one','Officer One','14590001','Strong',1,'{}');
        INSERT INTO radio_association_evidence
            (id,association_id,archive_date,talkgroup_number,website_visible,source_json,reviewed,correction_notes,revision)
            VALUES ('e','a','2026-11-01',6001,1,'[]',1,'Move clip 2 elsewhere',3);
        INSERT INTO radio_association_evidence_clips VALUES ('e','clip1',1,1);
        INSERT INTO radio_association_assignments VALUES ('rule','shared-use','{}');
    """)
    db.execute("UPDATE radio_clips SET transcript=? WHERE id='clip1'", ('I’ll ["be right back" / "bring it back"].\nSecond line.',))
    db.commit()
    return db


class PromotionTests(unittest.TestCase):
    def test_full_copy_preserves_reviews_and_sequences_and_removes_destination_only_data(self):
        source = fixture()
        target = fixture()
        target.executescript("CREATE TABLE obsolete (id INTEGER); INSERT INTO obsolete VALUES (99);")
        target.execute("UPDATE radio_association_evidence SET correction_notes='old',reviewed=0")
        target.commit()
        target.execute('PRAGMA foreign_keys=ON')
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'copy.sql'
            expected = prepare_promotion(source, user_schema(target), output)
            target.executescript(output.read_text())
            self.assertNotIn('obsolete', {row['name'] for row in user_schema(target)})
            for table in expected:
                self.assertEqual(fingerprint(source, table), fingerprint(target, table))
            self.assertEqual(target.execute('SELECT seq FROM sqlite_sequence WHERE name="serials"').fetchone(), (10,))
            self.assertEqual(target.execute('PRAGMA foreign_key_check').fetchall(), [])
            self.assertEqual(target.execute('SELECT speaker_confirmed FROM radio_association_evidence_clips').fetchone(), (1,))

    def test_fixed_direction_exports_only_staging_and_verifies_production_without_backup(self):
        source, target = fixture(), fixture()
        calls = []

        def runner(*args, capture=False):
            calls.append(args)
            if args[1] == 'export':
                self.assertEqual(args[2], SOURCE)
                output = Path(next(arg.split('=', 1)[1] for arg in args if arg.startswith('--output=')))
                output.write_text('\n'.join(source.iterdump()))
                return SimpleNamespace(stdout='')
            self.assertEqual(args[2], TARGET)
            sql_file = next((arg.split('=', 1)[1] for arg in args if arg.startswith('--file=')), None)
            if sql_file:
                target.executescript(Path(sql_file).read_text())
                return SimpleNamespace(stdout='')
            cursor = target.execute(args[args.index('--command') + 1])
            names = [column[0] for column in cursor.description]
            rows = [dict(zip(names, row)) for row in cursor]
            return SimpleNamespace(stdout=json.dumps([{'success': True, 'results': rows}]))

        with tempfile.TemporaryDirectory() as directory:
            promote(Path(directory) / 'promotion', runner)
        self.assertEqual([call[2] for call in calls if call[1] == 'export'], [SOURCE])
        self.assertEqual(sum(any(arg.startswith('--file=') for arg in call) for call in calls), 1)
        self.assertEqual(target.execute('SELECT reviewed,correction_notes FROM radio_association_evidence').fetchone(), (1, 'Move clip 2 elsewhere'))

    def test_empty_or_lossy_staging_snapshot_stops_before_production_write(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'copy.sql'
            source = fixture()
            source.execute('DELETE FROM radio_clips')
            source.commit()
            with self.assertRaisesRegex(ValueError, 'no radio recordings'):
                prepare_promotion(source, [], output)
            source = fixture()
            source.execute("UPDATE radio_clips SET transcript=? WHERE id='clip1'", ('embedded\x00null',))
            source.commit()
            with self.assertRaisesRegex(ValueError, 'changed radio_clips'):
                prepare_promotion(source, [], output)

    def test_make_commands_reject_removed_database_selector(self):
        for name in ('db-upload', 'db-reset', 'calls-from-db', 'promote-db'):
            with self.subTest(name=name):
                normal = subprocess.run(['make', '-n', name], cwd=ROOT, capture_output=True, text=True)
                self.assertEqual(normal.returncode, 0)
                self.assertNotIn('--database', normal.stdout)
                removed = subprocess.run(['make', '-n', name, 'D1_DATABASE=afpd-data'], cwd=ROOT, capture_output=True, text=True)
                self.assertNotEqual(removed.returncode, 0)
                self.assertIn('no longer supported', removed.stderr)
        for script in ('upload_d1.py', 'calls_from_db.py', 'promote_db.py'):
            result = subprocess.run([sys.executable, str(ROOT / 'db' / script), '--database', TARGET], cwd=ROOT, capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('unrecognized arguments', result.stderr)


if __name__ == '__main__':
    unittest.main()
