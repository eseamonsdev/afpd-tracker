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

    def exporter(self, path):
        self.exports += 1
        path.write_text('\n'.join(self.db.iterdump()), encoding='utf-8')

    def sync(self, exporter=None):
        synchronize(self.root, exporter or self.exporter)

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

    def test_first_sync_flags_ambiguous_saved_differences_without_exporting_json(self):
        before = (self.root / ARCHIVE).read_bytes()
        self.db.execute("UPDATE radio_clips SET transcript='Different saved value'")
        with self.assertRaisesRegex(ReconcileRequired, 'reconciliation first'):
            self.sync()
        self.assertEqual(self.conflicts()[0]['reason'], 'no-baseline')
        self.assertEqual((self.root / ARCHIVE).read_bytes(), before)
        self.assertFalse((self.root / STATE).exists())
        self.assertEqual(git(self.root, 'status', '--porcelain'), '')

    def test_saved_semantic_conflicts_are_detected_without_git_merge_conflicts(self):
        self.sync()
        self.edit_local_transcript('Committed local edit')
        self.db.execute("UPDATE radio_clips SET transcript='Different admin edit'")
        commit = git(self.root, 'rev-parse', 'HEAD')
        with self.assertRaisesRegex(ReconcileRequired, 'reconciliation first'):
            self.sync()
        issue = self.conflicts()[0]
        self.assertEqual(issue['reason'], 'both-changed')
        self.assertEqual(issue['baseline'], 'Original transcript')
        self.assertEqual(issue['json'], 'Committed local edit')
        self.assertEqual(issue['database'], 'Different admin edit')
        self.assertEqual(git(self.root, 'rev-parse', 'HEAD'), commit)
        self.assertEqual(git(self.root, 'status', '--porcelain'), '')

    def test_json_only_edits_and_evidence_note_conflicts_require_explicit_reconciliation(self):
        self.sync()
        self.edit_local_transcript('JSON only')
        with self.assertRaises(ReconcileRequired):
            self.sync()
        self.assertEqual(self.conflicts()[0]['reason'], 'json-only')
        # Resolve the transcript on both sides, then establish its new baseline.
        self.db.execute("UPDATE radio_clips SET transcript='JSON only'")
        self.sync()
        path = self.root / EVIDENCE
        document = json.loads(path.read_text())
        document['radio_ids']['14590001']['associations'][0]['evidence'][0]['correction_notes'] = 'Local note'
        path.write_text(json.dumps(document, indent=2) + '\n')
        git(self.root, 'add', EVIDENCE)
        git(self.root, 'commit', '-m', 'Local evidence change')
        self.db.execute("UPDATE radio_association_evidence SET correction_notes='Admin note',revision=1")
        with self.assertRaises(ReconcileRequired):
            self.sync()
        self.assertTrue(any(c['kind'] == 'evidence' and c['reason'] == 'both-changed' for c in self.conflicts()))
        self.assertIn('Local note', path.read_text())

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
        with self.assertRaisesRegex(ReconcileRequired, 'missing'):
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
