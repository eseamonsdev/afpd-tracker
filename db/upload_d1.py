"""Rebuild SQLite and replace this project's tables in an existing remote D1 DB.

Run `make wrangler-login` separately when Wrangler authentication expires.
The generated SQL and the pre-upload D1 backup stay in ignored db/local/.
"""

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import sqlite3
import subprocess
import sys

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
LOCAL = HERE / 'local'
SQLITE = LOCAL / 'afpd.sqlite'
IMPORT = LOCAL / 'afpd-d1-import.sql'
WRANGLER = ROOT / 'node_modules/.bin/wrangler'

TABLES = ('officers', 'officer_names', 'radio_talkgroups', 'radio_ids',
          'radio_clips', 'radio_clip_radio_ids')
SCHEMA_FILES = (HERE / 'migrations/0001_officer_names.sql',
                HERE / 'migrations/0002_radio.sql')
# This also removes the pre-rename table if it exists in the remote database.
DROP_ORDER = ('radio_clip_radio_ids', 'radio_clip_sources', 'radio_clips',
              'radio_ids', 'radio_talkgroups', 'officer_names', 'officers')


def run(*args, capture=False):
    return subprocess.run(args, cwd=ROOT, check=True, text=True,
                          capture_output=capture)


def counts(database):
    with sqlite3.connect(f'file:{database}?mode=ro', uri=True) as connection:
        violations = connection.execute('PRAGMA foreign_key_check').fetchall()
        if violations:
            raise ValueError(f'Local database has foreign key violations: {violations[:3]}')
        return {table: connection.execute(f'SELECT COUNT(*) FROM {table}').fetchone()[0]
                for table in TABLES}


def write_import(database, output):
    """SQLite dump without transaction statements, as required by D1 import."""
    with sqlite3.connect(f'file:{database}?mode=ro', uri=True) as connection, \
            output.open('w', encoding='utf-8') as stream:
        stream.write('PRAGMA defer_foreign_keys = ON;\n')
        for table in DROP_ORDER:
            stream.write(f'DROP TABLE IF EXISTS {table};\n')
        # Create every table before importing rows: the local dump sorts names
        # alphabetically, which would insert officer_names before officers.
        for schema in SCHEMA_FILES:
            stream.write(schema.read_text(encoding='utf-8') + '\n')
        for statement in connection.iterdump():
            if statement in ('BEGIN TRANSACTION;', 'COMMIT;'):
                continue
            if not statement.startswith('INSERT INTO '):
                if statement.startswith(('CREATE TABLE ', 'CREATE INDEX ')):
                    continue
                raise ValueError(f'Unexpected SQLite dump statement: {statement[:100]}')
            stream.write(statement + '\n')


def result_rows(output):
    payload = json.loads(output)
    if isinstance(payload, list):
        if len(payload) != 1:
            raise ValueError('Unexpected number of D1 query results')
        payload = payload[0]
    if not payload.get('success', False):
        raise ValueError('D1 verification query failed')
    return payload['results']


def verify_remote(database, expected):
    for table, count in expected.items():
        query = f'SELECT COUNT(*) AS count FROM {table}'
        response = run(str(WRANGLER), 'd1', 'execute', database, '--remote',
                       '--command', query, '--json', capture=True)
        rows = result_rows(response.stdout)
        if len(rows) != 1 or rows[0].get('count') != count:
            raise ValueError(f'{table}: expected {count} rows; D1 returned {rows}')
    print('Verified D1 rows: ' + ', '.join(f'{table}={n}' for table, n in expected.items()))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database', default='afpd-data', help='Existing remote D1 database name')
    parser.add_argument('--prepare-only', action='store_true',
                        help='Rebuild SQLite and SQL without contacting Cloudflare')
    args = parser.parse_args()
    if not args.prepare_only and not WRANGLER.is_file():
        parser.error('Wrangler is not installed; run npm ci first')
    LOCAL.mkdir(parents=True, exist_ok=True)
    run(sys.executable, str(HERE / 'create_afpd_db.py'), '--output', str(SQLITE), '--replace')
    expected = counts(SQLITE)
    write_import(SQLITE, IMPORT)
    print(f'Prepared {IMPORT} ({IMPORT.stat().st_size:,} bytes)', flush=True)
    if args.prepare_only:
        return
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    backup = LOCAL / f'{args.database}-before-upload-{stamp}.sql'
    print(f'Backing up remote {args.database} to {backup}', flush=True)
    run(str(WRANGLER), 'd1', 'export', args.database, '--remote',
        f'--output={backup}', '--skip-confirmation')
    if not backup.is_file() or not backup.stat().st_size:
        raise ValueError('D1 export did not produce a backup; upload cancelled')
    print(f'Replacing managed tables in remote {args.database}', flush=True)
    run(str(WRANGLER), 'd1', 'execute', args.database, '--remote',
        f'--file={IMPORT}', '--yes')
    verify_remote(args.database, expected)
    print(f'D1 upload complete. Pre-upload backup: {backup}', flush=True)


if __name__ == '__main__':
    main()
