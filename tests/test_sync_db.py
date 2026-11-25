import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'db'))
from sync_db import synchronize, ReconcileRequired, STATE, REPORT, EVIDENCE
from evidence_from_db import DATABASE, SCHEMA, snapshot_from_rows, rows_from_db, write_snapshot

ARCHIVE = 'public/records/openmhz/day/calls.json'


def git(root, *args):
    return subprocess.run(['git', *args], cwd=root, text=True, capture_output=True, check=True).stdout.strip()


class SyncTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.remote = self.directory / 'remote.git'
        self.root = self.directory / 'checkout'
        self.peer = self.directory / 'peer'
        git(self.directory, 'init', '--bare', str(self.remote))
        self.root.mkdir()
        git(self.root, 'init', '-b', 'staging')
        git(self.root, 'config', 'user.name', 'Sync test')
        git(self.root, 'config', 'user.email', 'sync@example.org')
        git(self.root, 'remote', 'add', 'origin', str(self.remote))
        (self.root / '.gitignore').write_text('db/local/\n')
        self.db = sqlite3.connect(':memory:')
        self.addCleanup(self.db.close)
        self.db.executescript(SCHEMA.read_text())
        self.db.executescript('''
          CREATE TABLE radio_clips (id TEXT PRIMARY KEY,archive_path TEXT,transcript TEXT,transcript_validated INTEGER);
          INSERT INTO radio_associations VALUES ('a','officer','Officer','14590001','Strong',1,'{}');
          INSERT INTO radio_association_evidence (id,association_id,archive_date,talkgroup_number,source_json)
            VALUES ('e','a','2026-11-01',6001,'[]');
          INSERT INTO radio_association_evidence_clips VALUES ('e','clip1',1,0);
        ''')
        self.db.execute('INSERT INTO radio_clips VALUES (?,?,?,?)', ('clip1', ARCHIVE, 'Original transcript', 0))
        self.db.commit()
        path = self.root / ARCHIVE
        path.parent.mkdir(parents=True)
        path.write_text(json.dumps({'date': '2026-11-01', 'calls': [{'id': 'clip1', 'transcript': 'Original transcript', 'validated': False, 'note': 'Keep context'}]}, indent=2) + '\n')
        write_snapshot(snapshot_from_rows(rows_from_db(self.db)), self.root / EVIDENCE)
        git(self.root, 'add', '.')
        git(self.root, 'commit', '-m', 'Initial matching data')
        git(self.root, 'push', '-u', 'origin', 'staging')
        git(self.directory, 'clone', '-b', 'staging', str(self.remote), str(self.peer))
        git(self.peer, 'config', 'user.name', 'Peer')
        git(self.peer, 'config', 'user.email', 'peer@example.org')
        self.exports = 0
        self.imports = 0

    def exporter(self, path):
        self.exports += 1
        path.write_text('\n'.join(self.db.iterdump()), encoding='utf-8')

    def importer(self, path):
        self.imports += 1
        self.db.executescript(path.read_text(encoding='utf-8'))

    def sync(self, exporter=None, importer=None):
        synchronize(self.root, exporter or self.exporter, importer or self.importer)

    def edit_local_transcript(self, value):
        path = self.root / ARCHIVE
        data = json.loads(path.read_text())
        data['calls'][0]['transcript'] = value
        path.write_text(json.dumps(data, indent=2) + '\n')
        git(self.root, 'add', ARCHIVE)
        git(self.root, 'commit', '-m', 'Local transcript reconciliation')

    def conflicts(self):
        return json.loads((self.root / REPORT).read_text())['conflicts']

    def test_single_snapshot_sync_pushes_only_downloads_and_is_idempotent(self):
        self.sync()
        first = git(self.root, 'rev-parse', 'HEAD')
        self.db.execute("UPDATE radio_clips SET transcript='Saved admin edit',transcript_validated=1")
        self.db.execute("UPDATE radio_association_evidence SET correction_notes='Saved note',reviewed=1,revision=1")
        self.sync()
        self.assertEqual(self.exports, 2)
        self.assertNotEqual(git(self.root, 'rev-parse', 'HEAD'), first)
        self.assertEqual(set(git(self.root, 'diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD').splitlines()), {ARCHIVE, EVIDENCE})
        clip = json.loads((self.root / ARCHIVE).read_text())['calls'][0]
        self.assertEqual(clip, {'id': 'clip1', 'transcript': 'Saved admin edit', 'validated': True, 'note': 'Keep context'})
        self.assertEqual(git(self.root, 'status', '--porcelain'), '')
        self.assertEqual(json.loads((self.root / STATE).read_text())['commit'], git(self.remote, 'rev-parse', 'refs/heads/staging'))
        current = git(self.root, 'rev-parse', 'HEAD')
        self.sync()
        self.assertEqual(git(self.root, 'rev-parse', 'HEAD'), current)

    def test_dirty_or_staged_work_stops_without_stashing_or_exporting(self):
        path = self.root / 'unfinished.txt'
        path.write_text('Unfinished work')
        for staged in [False, True]:
            if staged:
                git(self.root, 'add', 'unfinished.txt')
            with self.assertRaisesRegex(ReconcileRequired, 'Local changes'):
                self.sync()
            self.assertEqual(self.exports, 0)
            self.assertEqual(path.read_text(), 'Unfinished work')
            self.assertEqual(git(self.root, 'stash', 'list'), '')

    def test_first_sync_accepts_database_differences_without_a_baseline(self):
        self.db.execute("UPDATE radio_clips SET transcript='Saved database edit',transcript_validated=1")
        self.db.execute("UPDATE radio_association_evidence SET correction_notes='Admin note',reviewed=1,revision=5")
        self.sync()
        self.assertEqual(json.loads((self.root / ARCHIVE).read_text())['calls'][0]['transcript'], 'Saved database edit')
        self.assertTrue((self.root / STATE).exists())
        self.assertFalse((self.root / REPORT).exists())
        self.assertEqual(self.imports, 0)

    def test_nonblank_database_transcript_wins_over_committed_json_edits(self):
        self.sync()
        self.edit_local_transcript('Committed local edit')
        self.db.execute("UPDATE radio_clips SET transcript='Latest saved admin edit'")
        self.sync()
        self.assertEqual(json.loads((self.root / ARCHIVE).read_text())['calls'][0]['transcript'], 'Latest saved admin edit')
        self.assertEqual(self.db.execute('SELECT transcript FROM radio_clips').fetchone(), ('Latest saved admin edit',))
        self.assertEqual(self.imports, 0)
        self.assertFalse((self.root / REPORT).exists())

    def test_json_only_and_evidence_edits_are_replaced_by_authoritative_database_values(self):
        self.sync()
        self.edit_local_transcript('JSON only')
        path = self.root / EVIDENCE
        document = json.loads(path.read_text())
        document['radio_ids']['14590001']['associations'][0]['evidence'][0]['correction_notes'] = 'Local note'
        path.write_text(json.dumps(document, indent=2) + '\n')
        git(self.root, 'add', EVIDENCE); git(self.root, 'commit', '-m', 'Local evidence change')
        self.db.execute("UPDATE radio_association_evidence SET correction_notes='Admin note',revision=1")
        self.sync()
        self.assertEqual(json.loads((self.root / ARCHIVE).read_text())['calls'][0]['transcript'], 'Original transcript')
        self.assertIn('Admin note', path.read_text())
        self.assertNotIn('Local note', path.read_text())
        self.assertEqual(self.imports, 0)

    def test_blank_database_receives_first_time_json_transcripts_including_verification(self):
        self.db.execute('UPDATE radio_clips SET transcript=NULL')
        path = self.root / ARCHIVE
        document = json.loads(path.read_text())
        document['calls'][0]['transcript'] = "First transcript: O'Brien.\nSecond line."
        document['calls'][0]['validated'] = True
        path.write_text(json.dumps(document, indent=2) + '\n')
        git(self.root, 'add', ARCHIVE); git(self.root, 'commit', '-m', 'First transcription')
        self.sync()
        self.assertEqual(self.imports, 1)
        self.assertEqual(self.exports, 2)
        self.assertEqual(self.db.execute('SELECT transcript,transcript_validated FROM radio_clips').fetchone(), ("First transcript: O'Brien.\nSecond line.", 1))
        self.assertEqual(json.loads(path.read_text())['calls'][0]['transcript'], "First transcript: O'Brien.\nSecond line.")
        # No baseline is required, and a later run does not re-import it.
        self.sync()
        self.assertEqual(self.imports, 1)

    def test_concurrent_admin_save_wins_over_a_pending_first_transcript_import(self):
        self.db.execute("UPDATE radio_clips SET transcript='   '")
        def concurrent_import(path):
            self.db.execute("UPDATE radio_clips SET transcript='Just saved in admin',transcript_validated=1")
            self.importer(path)
        self.sync(importer=concurrent_import)
        self.assertEqual(self.db.execute('SELECT transcript,transcript_validated FROM radio_clips').fetchone(), ('Just saved in admin', 1))
        self.assertEqual(json.loads((self.root / ARCHIVE).read_text())['calls'][0]['transcript'], 'Just saved in admin')

    def test_old_baseline_or_report_does_not_block_database_authority(self):
        state = self.root / STATE; state.parent.mkdir(parents=True)
        state.write_text('{"old": "invalid baseline"}')
        (self.root / REPORT).write_text('{"conflicts": ["old first-run differences"]}')
        self.db.execute("UPDATE radio_clips SET transcript='Current saved edit'")
        self.sync()
        self.assertFalse((self.root / REPORT).exists())
        self.assertEqual(json.loads((self.root / ARCHIVE).read_text())['calls'][0]['transcript'], 'Current saved edit')

    def test_git_divergence_stops_before_database_read(self):
        (self.root / 'local.txt').write_text('Local commit')
        git(self.root, 'add', 'local.txt'); git(self.root, 'commit', '-m', 'Local')
        (self.peer / 'remote.txt').write_text('Remote commit')
        git(self.peer, 'add', 'remote.txt'); git(self.peer, 'commit', '-m', 'Remote'); git(self.peer, 'push', 'origin', 'staging')
        with self.assertRaisesRegex(ReconcileRequired, 'diverged'):
            self.sync()
        self.assertEqual(self.exports, 0)
        self.assertFalse((self.root / 'remote.txt').exists())

    def test_same_edit_on_both_sides_is_accepted_and_remote_fast_forward_is_pulled(self):
        self.sync()
        path = self.peer / ARCHIVE
        document = json.loads(path.read_text())
        document['calls'][0]['transcript'] = 'Same reconciled edit'
        path.write_text(json.dumps(document, indent=2) + '\n')
        git(self.peer, 'add', ARCHIVE); git(self.peer, 'commit', '-m', 'Peer reconciliation'); git(self.peer, 'push', 'origin', 'staging')
        self.db.execute("UPDATE radio_clips SET transcript='Same reconciled edit'")
        self.sync()
        self.assertEqual(git(self.root, 'rev-parse', 'HEAD'), git(self.peer, 'rev-parse', 'HEAD'))
        self.assertEqual(json.loads((self.root / ARCHIVE).read_text())['calls'][0]['transcript'], 'Same reconciled edit')

    def test_extra_json_clip_cannot_be_silently_dropped(self):
        self.sync()
        path = self.root / ARCHIVE
        document = json.loads(path.read_text())
        document['calls'].append({'id': 'new-clip', 'transcript': 'Reconcile this new clip'})
        path.write_text(json.dumps(document, indent=2) + '\n')
        git(self.root, 'add', ARCHIVE); git(self.root, 'commit', '-m', 'New JSON clip')
        before = path.read_bytes()
        with self.assertRaisesRegex(ValueError, 'clip IDs differ'):
            self.sync()
        self.assertEqual(path.read_bytes(), before)
        self.assertEqual(git(self.root, 'status', '--porcelain'), '')

    def test_archive_mismatch_stops_before_evidence_or_json_writes(self):
        before = (self.root / EVIDENCE).read_bytes()
        self.db.execute('INSERT INTO radio_clips VALUES (?,?,?,?)', ('missing', ARCHIVE, 'Missing clip', 0))
        with self.assertRaisesRegex(ValueError, 'clip IDs differ'):
            self.sync()
        self.assertEqual((self.root / EVIDENCE).read_bytes(), before)
        self.assertEqual(git(self.root, 'status', '--porcelain'), '')

    def test_remote_race_rejects_push_without_force_and_keeps_the_sync_commit(self):
        self.sync()
        old_state = (self.root / STATE).read_bytes()
        self.db.execute("UPDATE radio_clips SET transcript='Admin update'")
        def racing_export(path):
            self.exporter(path)
            (self.peer / 'racing.txt').write_text('Remote update during download')
            git(self.peer, 'add', 'racing.txt'); git(self.peer, 'commit', '-m', 'Racing update'); git(self.peer, 'push', 'origin', 'staging')
        with self.assertRaisesRegex(ReconcileRequired, 'No force-push'):
            self.sync(racing_export)
        self.assertEqual((self.root / STATE).read_bytes(), old_state)
        self.assertEqual(json.loads((self.root / ARCHIVE).read_text())['calls'][0]['transcript'], 'Admin update')
        self.assertNotEqual(git(self.root, 'rev-parse', 'HEAD'), git(self.remote, 'rev-parse', 'refs/heads/staging'))
        self.assertEqual(git(self.root, 'status', '--porcelain'), '')

    def test_make_rejects_database_override(self):
        result = subprocess.run(['make', '-n', 'db-sync', 'D1_DATABASE=afpd-data'], cwd=ROOT, text=True, capture_output=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('no longer supported', result.stderr)


if __name__ == '__main__':
    unittest.main()
