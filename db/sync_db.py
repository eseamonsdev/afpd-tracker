"""Sync authoritative staging admin data to JSON and Git.

Only blank database transcripts can receive first-time JSON text. No reset,
deployment, auto-stash, rebase or force-push.
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
                              snapshot_from_rows, rows_from_snapshot, write_snapshot, quote)

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


def first_transcript_sql(connection, root):
    """Only fill blank database transcripts; a saved nonblank value always wins."""
    archives, statements = {}, []
    for clip_id, path, transcript, validated in connection.execute(
            'SELECT id,archive_path,transcript,transcript_validated FROM radio_clips ORDER BY archive_path,id'):
        if isinstance(transcript, str) and transcript.strip():
            continue
        if path not in archives:
            data = json.loads((root / path).read_text(encoding='utf-8'))
            archives[path] = {c['id']: c for c in data['calls']}
        call = archives[path][clip_id]
        local = call.get('transcript')
        if not isinstance(local, str) or not local.strip():
            continue
        if '\0' in local or len(local) > 30000 or type(call.get('validated', False)) is not bool:
            raise ValueError(f'Invalid first-time transcript for {clip_id} in {path}')
        statements.append(f"UPDATE radio_clips SET transcript={quote(local)},transcript_validated={int(call.get('validated', False))} "
                          f"WHERE id={quote(clip_id)} AND transcript IS {quote(transcript)} AND transcript_validated={int(validated)};")
    return '\n'.join(statements) + ('\n' if statements else '')


def import_first_transcripts(path):
    subprocess.run([str(WRANGLER), 'd1', 'execute', DATABASE, '--remote',
                    f'--file={path}', '--yes'], cwd=ROOT, check=True)


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


def synchronize(root=ROOT, exporter=export_staging, importer=import_first_transcripts):
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
        with tempfile.TemporaryDirectory(prefix='afpd-db-sync-') as directory:
            dump = Path(directory) / 'staging.sql'
            sql_file = Path(directory) / 'first-transcripts.sql'
            for attempt in range(4):
                dump.unlink(missing_ok=True)
                exporter(dump)
                with sqlite3.connect(':memory:') as connection:
                    connection.executescript(dump.read_text(encoding='utf-8'))
                    snapshot = snapshot_from_rows(rows_from_db(connection))
                    rows_from_snapshot(snapshot)
                    # Validate every archive ID before any database or JSON write.
                    reconcile(connection, root / 'public/records/openmhz', root=root, write=False)
                    sql = first_transcript_sql(connection, root)
                    if git(root, 'rev-parse', 'HEAD').stdout.strip() != start or git(root, 'status', '--porcelain', '--untracked-files=all').stdout:
                        raise ReconcileRequired('The checkout changed during the download. Stop and resolve the Git changes first.')
                    if sql:
                        if attempt == 3:
                            raise ReconcileRequired('First-time transcript import changed concurrently. Retry make db-sync; saved database text was not overwritten.')
                        sql_file.write_text(sql, encoding='utf-8')
                        importer(sql_file)
                        # Re-export to include concurrent admin saves and confirm the
                        # conditional imports. Never export from a guessed local DB.
                        continue
                    reconcile(connection, root / 'public/records/openmhz', root=root)
                    write_snapshot(snapshot, root / EVIDENCE)
                    break

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
        print(f'Staging admin data synced and pushed ({commit[:12]}). Saved database values are authoritative; only blank transcripts can be filled from JSON.')


def main():
    argparse.ArgumentParser(description=__doc__).parse_args()
    try:
        synchronize()
    except (ReconcileRequired, ValueError, sqlite3.Error, OSError, subprocess.CalledProcessError) as error:
        raise SystemExit(f'db-sync stopped: {error}\nResolve the reported issue before rerunning make db-sync.') from error


if __name__ == '__main__':
    main()
