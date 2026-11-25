"""Save staging admin edits to JSON and Git, stopping for reconciliation.

No database writes, deployment, auto-stash, rebase or force-push.
"""

import argparse
from contextlib import contextmanager
import fcntl
import json
from pathlib import Path
import sqlite3
import subprocess
import tempfile

from calls_from_db import reconcile
from evidence_from_db import (DATABASE, ROOT, WRANGLER, rows_from_db,
                              snapshot_from_rows, rows_from_snapshot, write_snapshot)

EVIDENCE = 'data/db-evidenence-associations.json'
STATE = 'db/local/db-sync-state.json'
REPORT = 'db/local/db-sync-conflicts.json'


class ReconcileRequired(RuntimeError):
    pass


def git(root, *args, check=True):
    result = subprocess.run(['git', *args], cwd=root, text=True, capture_output=True)
    if check and result.returncode:
        raise ReconcileRequired(f'Git command failed: git {" ".join(args)}\n{result.stderr.strip()}\n'
                                'Reconcile first, then rerun make db-sync. No force-push was attempted.')
    return result


def git_json(root, commit, path):
    if not commit:
        return None
    result = git(root, 'show', f'{commit}:{path}', check=False)
    if result.returncode:
        # A file absent at a valid baseline is a newly introduced archive/file.
        return None
    return json.loads(result.stdout)


def transcript_conflicts(connection, root, baseline):
    local, original, issues = {}, {}, []
    for clip_id, path, transcript, validated in connection.execute(
            'SELECT id,archive_path,transcript,transcript_validated FROM radio_clips ORDER BY archive_path,id'):
        file = (root / path).resolve()
        archives = (root / 'public/records/openmhz').resolve()
        if not file.is_relative_to(archives) or file.name != 'calls.json' or not file.is_file():
            raise ReconcileRequired(f'Missing or invalid archive: {path}. Reconcile the archive first.')
        if path not in local:
            data = json.loads(file.read_text(encoding='utf-8'))
            if len({c['id'] for c in data['calls']}) != len(data['calls']):
                raise ReconcileRequired(f'Duplicate clip IDs in {path}. Reconcile first.')
            local[path] = {c['id']: {'transcript': c.get('transcript'), 'validated': c.get('validated', False)} for c in data['calls']}
            old = git_json(root, baseline, path)
            original[path] = {c['id']: {'transcript': c.get('transcript'), 'validated': c.get('validated', False)} for c in old['calls']} if old else {}
        if clip_id not in local[path]:
            raise ReconcileRequired(f'Database clip {clip_id} is missing from {path}. Reconcile the archive first.')
        call, base = local[path][clip_id], original[path].get(clip_id)
        for field, database_value in [('transcript', transcript), ('validated', validated == 1)]:
            local_value = call.get(field, False if field == 'validated' else None)
            if local_value == database_value:
                continue
            base_value = base.get(field, False if field == 'validated' else None) if base else None
            if base is not None and local_value == base_value:
                continue  # Only the saved database field changed.
            reason = 'no-baseline' if base is None else 'json-only' if database_value == base_value else 'both-changed'
            issues.append({'kind': 'clip', 'path': path, 'clip_id': clip_id, 'field': field,
                           'reason': reason, 'baseline': base_value, 'json': local_value, 'database': database_value})
    return issues


def evidence_records(document):
    if document is None:
        return {}
    rows_from_snapshot(document)
    records = {}
    for radio_id, radio in document['radio_ids'].items():
        for association in radio['associations']:
            records['association:' + association['id']] = {
                **{key: value for key, value in association.items() if key != 'evidence'}, 'radio_id': radio_id}
            for group in association['evidence']:
                records['group:' + group['id']] = {**group, 'association_id': association['id']}
    for record in document['assignments']:
        records['assignment:' + record['id']] = record
    return records


def evidence_conflicts(database, local, baseline):
    # No existing local file means this is the first evidence download.
    if local is None:
        return []
    remote, current, original = map(evidence_records, (database, local, baseline))
    issues = []
    missing = object()
    for key in sorted(remote.keys() | current.keys() | original.keys()):
        db_value, local_value, base_value = (records.get(key, missing) for records in (remote, current, original))
        if local_value == db_value:
            continue
        if baseline is not None and local_value == base_value:
            continue
        reason = 'no-baseline' if baseline is None else 'json-only' if db_value == base_value else 'both-changed'
        issues.append({'kind': 'evidence', 'record': key, 'reason': reason,
                       'baseline': None if base_value is missing else base_value,
                       'json': None if local_value is missing else local_value,
                       'database': None if db_value is missing else db_value})
    return issues


def export_staging(path):
    subprocess.run([str(WRANGLER), 'd1', 'export', DATABASE, '--remote',
                    f'--output={path}', '--skip-confirmation'], cwd=ROOT, check=True)


@contextmanager
def sync_lock(root):
    path = Path(git(root, 'rev-parse', '--git-path', 'db-sync.lock').stdout.strip())
    if not path.is_absolute():
        path = root / path
    with path.open('w') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise ReconcileRequired('Another db-sync is running in this checkout. Wait for it to finish.') from error
        yield


def synchronize(root=ROOT, exporter=export_staging):
    root = Path(root).resolve()
    with sync_lock(root):
        if git(root, 'branch', '--show-current').stdout.strip() != 'staging':
            raise ReconcileRequired('Run make db-sync on the staging branch. No files were changed.')
        for marker in ('MERGE_HEAD', 'rebase-merge', 'rebase-apply', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'sequencer'):
            path = Path(git(root, 'rev-parse', '--git-path', marker).stdout.strip())
            if not path.is_absolute():
                path = root / path
            if path.exists():
                raise ReconcileRequired('A Git merge, rebase or other operation is unfinished. Reconcile first.')
        if git(root, 'status', '--porcelain', '--untracked-files=all').stdout:
            raise ReconcileRequired('Local changes need reconciliation. Finish and commit them first, then rerun make db-sync. Nothing was stashed or overwritten.')

        git(root, 'fetch', 'origin', 'staging')
        ahead, behind = map(int, git(root, 'rev-list', '--left-right', '--count', 'HEAD...refs/remotes/origin/staging').stdout.split())
        if ahead and behind:
            raise ReconcileRequired('Local and remote staging have diverged. Reconcile the branches first, then rerun make db-sync.')
        git(root, 'pull', '--ff-only', 'origin', 'staging')
        start = git(root, 'rev-parse', 'HEAD').stdout.strip()
        state_file = root / STATE
        state = json.loads(state_file.read_text()) if state_file.is_file() else None
        baseline = state.get('commit') if state else None
        if state and (state.get('schema_version') != 1 or state.get('database') != DATABASE or
                      not isinstance(baseline, str) or git(root, 'cat-file', '-e', f'{baseline}^{{commit}}', check=False).returncode):
            raise ReconcileRequired('The previous sync baseline is unavailable or invalid. Reconcile the local sync state first.')
        if baseline and git(root, 'merge-base', '--is-ancestor', baseline, start, check=False).returncode:
            raise ReconcileRequired('Staging no longer descends from the last sync baseline. Reconcile the local sync state first.')
        with tempfile.TemporaryDirectory(prefix='afpd-db-sync-') as directory:
            dump = Path(directory) / 'staging.sql'
            exporter(dump)
            with sqlite3.connect(':memory:') as connection:
                connection.executescript(dump.read_text(encoding='utf-8'))
                snapshot = snapshot_from_rows(rows_from_db(connection))
                rows_from_snapshot(snapshot)
                local_file = root / EVIDENCE
                local_snapshot = json.loads(local_file.read_text(encoding='utf-8')) if local_file.is_file() else None
                issues = transcript_conflicts(connection, root, baseline)
                issues += evidence_conflicts(snapshot, local_snapshot, git_json(root, baseline, EVIDENCE))
                if issues:
                    report = root / REPORT
                    report.parent.mkdir(parents=True, exist_ok=True)
                    report.write_text(json.dumps({'schema_version': 1, 'database': DATABASE, 'head': start,
                                                  'baseline_commit': baseline, 'conflicts': issues}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
                    raise ReconcileRequired(f'{len(issues)} saved data differences require reconciliation first.\n'
                                            f'Report: {report}\nNo JSON was exported, committed or pushed. '
                                            'Review the listed clip fields/evidence records and reconcile the database and JSON. '
                                            'For the first sync, differences are flagged because there is no trusted baseline. '
                                            'Use the explicit download/upload commands only after deciding which values to keep, then rerun make db-sync.')
                if git(root, 'rev-parse', 'HEAD').stdout.strip() != start or git(root, 'status', '--porcelain', '--untracked-files=all').stdout:
                    raise ReconcileRequired('The checkout changed during the download. Reconcile first; no exported JSON was written.')
                # The archive reconciler validates every matching ID before writing.
                reconcile(connection, root / 'public/records/openmhz', root=root)
                write_snapshot(snapshot, root / EVIDENCE)

        changed = git(root, 'diff', '--name-only', '-z').stdout.split('\0')
        if (git(root, 'rev-parse', 'HEAD').stdout.strip() != start or
                git(root, 'branch', '--show-current').stdout.strip() != 'staging' or
                git(root, 'diff', '--cached', '--name-only').stdout):
            raise ReconcileRequired('The branch or index changed during sync. Reconcile first; downloaded JSON remains locally and nothing was committed or pushed.')
        untracked = git(root, 'ls-files', '--others', '--exclude-standard', '-z').stdout.split('\0')
        files = sorted({path for path in changed + untracked if path})
        if any(path != EVIDENCE and not (path.startswith('public/records/openmhz/') and path.endswith('/calls.json')) for path in files):
            raise ReconcileRequired('Unrelated files changed during sync. Reconcile first; exported data remains locally and nothing was committed or pushed.')
        if files:
            git(root, 'add', '--', *files)
            git(root, 'commit', '-m', 'Sync staging admin transcripts and evidence reviews')
        commit = git(root, 'rev-parse', 'HEAD').stdout.strip()
        git(root, 'push', 'origin', f'{commit}:refs/heads/staging')
        state_file.parent.mkdir(parents=True, exist_ok=True)
        temporary = state_file.with_suffix('.tmp')
        temporary.write_text(json.dumps({'schema_version': 1, 'database': DATABASE, 'commit': commit}, indent=2) + '\n')
        temporary.replace(state_file)
        (root / REPORT).unlink(missing_ok=True)
        print(f'Staging admin data synced and pushed ({commit[:12]}). No database upload or deployment was performed.')


def main():
    argparse.ArgumentParser(description=__doc__).parse_args()
    try:
        synchronize()
    except (ReconcileRequired, ValueError, sqlite3.Error, OSError, subprocess.CalledProcessError) as error:
        raise SystemExit(f'db-sync stopped: {error}\nResolve the reported issue before rerunning make db-sync.') from error


if __name__ == '__main__':
    main()
