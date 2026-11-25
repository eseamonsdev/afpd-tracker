import copy
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
from evidence_from_db import (DATABASE, OUTPUT, SCHEMA, TABLES, rows_from_db,
                              snapshot_from_rows, rows_from_snapshot,
                              write_snapshot, restore_sql, upload)


def fixture():
    db = sqlite3.connect(':memory:')
    db.execute('PRAGMA foreign_keys=ON')
    db.executescript(SCHEMA.read_text())
    db.executescript("""
      CREATE TABLE radio_clips (id TEXT PRIMARY KEY,transcript TEXT,transcript_validated INTEGER);
      INSERT INTO radio_clips VALUES ('clip1','Keep this transcript',1);
      INSERT INTO radio_associations VALUES ('a1','officer-one','Officer One','14590001','Strong',1,'{}');
      INSERT INTO radio_associations VALUES ('a2','officer-two','Officer Two','14590001','Disputed',0,'{"note":"Original attribution"}');
      INSERT INTO radio_association_evidence
        (id,association_id,archive_date,talkgroup_number,website_visible,source_json,reviewed,correction_notes,revision,updated_at,updated_by)
        VALUES ('e1','a1','2026-11-01',6001,1,'[{"evidence":"Responds to address"}]',1,'Move clip 2 elsewhere',4,'2026-11-25T18:00:00Z','editor');
      INSERT INTO radio_association_evidence (id,association_id,archive_date,talkgroup_number,website_visible,source_json)
        VALUES ('e2','a1','2026-11-01',5922,0,'[]'),('empty','a2','2026-11-02',6001,0,'[]');
      INSERT INTO radio_association_evidence_clips VALUES ('e1','clip1',12,1),('e1','context1',13,0),('e2','clip1',6,0);
      INSERT INTO radio_association_assignments VALUES ('rule','excluded','{"key":"disputed","value":{"reason":"Trainee"}}');
    """)
    db.execute("UPDATE radio_association_evidence SET correction_notes=? WHERE id='e1'", ("O'Brien said:\nMove this clip. ☑",))
    db.commit()
    return db


def logical_rows(db):
    data = rows_from_db(db)
    for table, rows in data.items():
        for row in rows:
            if 'source_json' in row:
                row['source_json'] = json.loads(row['source_json'])
    return data


class EvidenceSnapshotTests(unittest.TestCase):
    def test_deletion_records_round_trip_without_resurrecting_groups(self):
        source, target = fixture(), fixture()
        group = dict(zip(TABLES['radio_association_evidence'], source.execute("SELECT * FROM radio_association_evidence WHERE id='empty'").fetchone()))
        association = dict(zip(TABLES['radio_associations'], source.execute("SELECT * FROM radio_associations WHERE id='a2'").fetchone()))
        archived = {'group': group, 'association': association, 'clips': [], 'deleted_by': 'editor', 'deleted_at': '2026-11-25T19:00:00Z'}
        source.execute('INSERT INTO radio_association_assignments VALUES (?,?,?)', ('deleted-evidence-empty', 'deleted-evidence-group', json.dumps(archived)))
        source.execute("DELETE FROM radio_association_evidence WHERE id='empty'")
        source.execute("DELETE FROM radio_associations WHERE id='a2'")
        document = snapshot_from_rows(rows_from_db(source))
        target.executescript(restore_sql(document))
        self.assertIsNone(target.execute("SELECT id FROM radio_association_evidence WHERE id='empty'").fetchone())
        self.assertIsNone(target.execute("SELECT id FROM radio_associations WHERE id='a2'").fetchone())
        self.assertEqual(target.execute('SELECT COUNT(*) FROM radio_clips').fetchone(), (1,))
        # An explicit group in the file wins over its historical deletion record.
        restored = snapshot_from_rows(rows_from_db(fixture()))
        restored['assignments'].append(document['assignments'][0] if document['assignments'][0]['kind']=='deleted-evidence-group' else document['assignments'][1])
        target.executescript(restore_sql(restored))
        self.assertIsNotNone(target.execute("SELECT id FROM radio_association_evidence WHERE id='empty'").fetchone())

    def test_round_trip_includes_reviewed_unreviewed_hidden_empty_disputed_and_shared_clips(self):
        source, target = fixture(), sqlite3.connect(':memory:')
        target.execute('PRAGMA foreign_keys=ON')
        target.executescript(SCHEMA.read_text())
        document = snapshot_from_rows(rows_from_db(source))
        self.assertEqual(document['database'], DATABASE)
        associations = document['radio_ids']['14590001']['associations']
        self.assertEqual([a['officer_id'] for a in associations], ['officer-one', 'officer-two'])
        self.assertEqual(associations[1]['evidence'][0]['clips'], [])
        self.assertFalse(associations[1]['website_visible'])
        reviewed = next(g for g in associations[0]['evidence'] if g['reviewed'])
        self.assertEqual([c['speaker_confirmed'] for c in reviewed['clips']], [True, False])
        self.assertEqual(reviewed['clips'][0]['position'], 12)
        target.executescript(restore_sql(document))
        self.assertEqual(logical_rows(source), logical_rows(target))
        self.assertEqual(snapshot_from_rows(rows_from_snapshot(document)), document)

    def test_reupload_preserves_absent_groups_and_transcripts_but_restores_exact_membership(self):
        source, target = fixture(), fixture()
        document = snapshot_from_rows(rows_from_db(source))
        target.executescript("""
          INSERT INTO radio_association_evidence (id,association_id,archive_date,talkgroup_number,source_json)
            VALUES ('newer','a1','2026-11-03',6001,'[]');
          INSERT INTO radio_association_evidence_clips VALUES ('e1','later-added',99,0);
          UPDATE radio_association_evidence SET revision=8,reviewed=0,correction_notes='Changed later' WHERE id='e1';
        """)
        target.executescript(restore_sql(document))
        self.assertEqual(target.execute("SELECT revision,reviewed,correction_notes FROM radio_association_evidence WHERE id='e1'").fetchone(),
                         (9, 1, "O'Brien said:\nMove this clip. ☑"))
        self.assertIsNotNone(target.execute("SELECT id FROM radio_association_evidence WHERE id='newer'").fetchone())
        self.assertIsNone(target.execute("SELECT clip_id FROM radio_association_evidence_clips WHERE clip_id='later-added'").fetchone())
        self.assertEqual(target.execute('SELECT transcript,transcript_validated FROM radio_clips').fetchone(), ('Keep this transcript', 1))
        target.executescript(restore_sql(document))
        self.assertEqual(target.execute("SELECT revision FROM radio_association_evidence WHERE id='e1'").fetchone(), (10,))

    def test_invalid_or_future_documents_do_not_replace_last_good_export(self):
        valid = snapshot_from_rows(rows_from_db(fixture()))
        invalid = []
        for key, value in [('schema_version', 2), ('database', 'afpd-data'), ('unknown', 1)]:
            document = copy.deepcopy(valid); document[key] = value; invalid.append(document)
        for key, value in [('reviewed', 1), ('revision', -1), ('date', '2026-02-30'), ('talkgroup', True)]:
            document = copy.deepcopy(valid); document['radio_ids']['14590001']['associations'][0]['evidence'][0][key] = value; invalid.append(document)
        document = copy.deepcopy(valid)
        document['radio_ids']['14590001']['associations'][0]['evidence'].append(copy.deepcopy(document['radio_ids']['14590001']['associations'][0]['evidence'][0]))
        invalid.append(document)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'evidence.json'
            write_snapshot(valid, path); before = path.read_bytes()
            for document in invalid:
                with self.assertRaises((ValueError, sqlite3.IntegrityError)):
                    write_snapshot(document, path)
                self.assertEqual(path.read_bytes(), before)
            write_snapshot(valid, path)
            self.assertEqual(path.read_bytes(), before)

    def test_upload_is_fixed_to_staging_rehearsed_and_backed_up(self):
        db = fixture()
        document = snapshot_from_rows(rows_from_db(db))
        calls = []
        def runner(*args):
            calls.append(args)
            self.assertEqual(args[2], DATABASE)
            if args[1] == 'export':
                path = Path(next(a.split('=', 1)[1] for a in args if a.startswith('--output=')))
                path.write_text('\n'.join(db.iterdump()))
            else:
                self.assertEqual(args[1], 'execute')
                path = Path(next(a.split('=', 1)[1] for a in args if a.startswith('--file=')))
                self.assertTrue((path.parent / 'before-evidence-upload.json').is_file())
                db.executescript(path.read_text())
        with tempfile.TemporaryDirectory() as directory:
            upload(document, Path(directory) / 'upload', runner)
        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[0][1], 'export')
        self.assertEqual(calls[1][1], 'execute')

    def test_natural_key_collision_stops_before_remote_upload(self):
        source, destination = fixture(), fixture()
        document = snapshot_from_rows(rows_from_db(source))
        destination.execute("UPDATE radio_association_evidence SET id='different-stable-id' WHERE id='empty'")
        destination.commit()
        calls = []
        def runner(*args):
            calls.append(args)
            self.assertEqual(args[1], 'export')
            path = Path(next(a.split('=', 1)[1] for a in args if a.startswith('--output=')))
            path.write_text('\n'.join(destination.iterdump()))
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(sqlite3.IntegrityError):
                upload(document, Path(directory) / 'upload', runner)
        self.assertEqual(len(calls), 1)

    def test_make_commands_reject_database_override_and_cli_has_no_database_argument(self):
        for target in ['evidence-from-db', 'evidence-to-db']:
            result = subprocess.run(['make', '-n', target, 'D1_DATABASE=afpd-data'], cwd=ROOT, capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('no longer supported', result.stderr)
        result = subprocess.run([sys.executable, 'db/evidence_from_db.py', '--database', 'afpd-data'], cwd=ROOT, capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('unrecognized arguments', result.stderr)


if __name__ == '__main__':
    unittest.main()
