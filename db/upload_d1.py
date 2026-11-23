"""Import JSON-backed data into an existing remote D1 DB using table policies.

Run `make wrangler-login` separately when Wrangler authentication expires.
The generated SQL and the pre-upload D1 backup stay in ignored db/local/.
"""

import argparse
from contextlib import ExitStack
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
LOCAL = HERE / 'local'
SQLITE = LOCAL / 'afpd.sqlite'
IMPORT = LOCAL / 'afpd-d1-import.sql'
WRANGLER = ROOT / 'node_modules/.bin/wrangler'
POLICY = HERE / 'table-import-policy.json'

TABLES = ('officers', 'officer_names', 'radio_talkgroups', 'radio_ids', 'radio_archive_days',
          'radio_clips', 'radio_clip_radio_ids', 'radio_excerpts', 'radio_excerpt_clips',
          'sources', 'entity_source_links')
SCHEMAS = tuple(HERE / f'migrations/{name}' for name in (
    '0001_officer_names.sql', '0002_radio.sql', '0003_sources.sql',
    '0004_radio_archive_days.sql', '0005_radio_excerpts.sql',
    '0006_entity_source_links.sql'))
DROP_ORDER = ('entity_source_links', 'radio_excerpt_clips', 'radio_excerpts',
              'radio_clip_radio_ids', 'radio_clips', 'radio_archive_days',
              'radio_ids', 'radio_talkgroups', 'sources', 'officer_names', 'officers')
# A parent cannot be recreated while a dependent table keeps its old rows.
DEPENDENCIES = {
    'entity_source_links': ('sources',),
    'radio_archive_days': ('radio_talkgroups',),
    'radio_clips': ('radio_talkgroups', 'radio_archive_days'),
    'radio_clip_radio_ids': ('radio_clips', 'radio_ids'),
    'radio_excerpt_clips': ('radio_excerpts', 'radio_clips'),
}


def load_policy(path=POLICY):
    data = json.loads(path.read_text(encoding='utf-8'))
    if not isinstance(data, dict) or data.get('schema_version') != 1 or set(data) != {'schema_version', 'tables'}:
        raise ValueError(f'{path}: expected schema_version 1 and tables')
    modes = data['tables']
    if not isinstance(modes, dict) or set(modes) != set(TABLES) or any(
            mode not in ('recreate', 'insert_only') for mode in modes.values()):
        raise ValueError(f'{path}: specify recreate or insert_only for every table in {TABLES}')
    if modes['officers'] != modes['officer_names']:
        raise ValueError('officers and officer_names must have the same mode (circular references)')
    for child, parents in DEPENDENCIES.items():
        for parent in parents:
            if modes[parent] == 'recreate' and modes[child] == 'insert_only':
                raise ValueError(f'{child} must be recreated when {parent} is recreated')
    return modes


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


def write_import(database, output, modes):
    """Recreate selected tables and insert only missing rows in the others.

    D1 may apply a large import in multiple transactions. Deferred constraints
    cannot protect a dump that inserts child rows before their parent rows.
    """
    with sqlite3.connect(f'file:{database}?mode=ro', uri=True) as connection, \
            output.open('w', encoding='utf-8') as stream, ExitStack() as stack:
        inserts = {table: stack.enter_context(tempfile.TemporaryFile(mode='w+t', encoding='utf-8'))
                   for table in TABLES if table != 'officers'}
        stream.write('-- Generated from db/table-import-policy.json\n')
        if modes['officers'] == 'recreate':
            # A fresh or partially initialized D1 may have no officers table.
            # This temporary empty shell is dropped below; an existing table is
            # untouched. Break the circular reference before dropping either.
            stream.write('CREATE TABLE IF NOT EXISTS officers '
                         '(id INTEGER PRIMARY KEY, display_name_id INTEGER);\n')
            stream.write('UPDATE officers SET display_name_id = NULL;\n')
        for table in DROP_ORDER:
            if modes[table] == 'recreate':
                stream.write(f'DROP TABLE IF EXISTS {table};\n')
        for schema in SCHEMAS:
            sql = schema.read_text(encoding='utf-8')
            sql = re.sub(r'\bCREATE TABLE\s+', 'CREATE TABLE IF NOT EXISTS ', sql)
            sql = re.sub(r'\bCREATE INDEX\s+', 'CREATE INDEX IF NOT EXISTS ', sql)
            stream.write(sql + '\n')
        for statement in connection.iterdump():
            if statement in ('BEGIN TRANSACTION;', 'COMMIT;'):
                continue
            if statement.startswith(('CREATE TABLE ', 'CREATE INDEX ')):
                continue
            match = re.match(r'^INSERT INTO "([^"]+)" ', statement)
            if not match or match.group(1) not in TABLES:
                raise ValueError(f'Unexpected SQLite dump statement: {statement[:100]}')
            if match.group(1) != 'officers':
                if modes[match.group(1)] == 'insert_only':
                    statement = statement.replace('INSERT INTO ', 'INSERT OR IGNORE INTO ', 1)
                inserts[match.group(1)].write(statement + '\n')

        # Officers are inserted without their display-name reference. Restore
        # that reference only after the name rows exist.
        for officer_id, legacy, slug, _ in connection.execute(
                'SELECT id, legacy_entity_id, url_slug, display_name_id FROM officers ORDER BY id'):
            quoted = [connection.execute('SELECT quote(?)', (value,)).fetchone()[0]
                      for value in (legacy, slug)]
            insert = 'INSERT OR IGNORE' if modes['officers'] == 'insert_only' else 'INSERT'
            stream.write(f'{insert} INTO officers VALUES({officer_id},{quoted[0]},{quoted[1]},NULL);\n')
        for table in TABLES[1:]:
            inserts[table].seek(0)
            shutil.copyfileobj(inserts[table], stream)
            if table == 'officer_names':
                for officer_id, name_id in connection.execute(
                        'SELECT id, display_name_id FROM officers ORDER BY id'):
                    condition = ' AND display_name_id IS NULL' if modes['officers'] == 'insert_only' else ''
                    stream.write(f'UPDATE officers SET display_name_id={name_id} '
                                 f'WHERE id={officer_id}{condition};\n')


def result_rows(output):
    payload = json.loads(output)
    if isinstance(payload, list):
        if len(payload) != 1:
            raise ValueError('Unexpected number of D1 query results')
        payload = payload[0]
    if not payload.get('success', False):
        raise ValueError('D1 verification query failed')
    return payload['results']


def verify_remote(database, expected, modes):
    for table, count in expected.items():
        query = f'SELECT COUNT(*) AS count FROM {table}'
        response = run(str(WRANGLER), 'd1', 'execute', database, '--remote',
                       '--command', query, '--json', capture=True)
        rows = result_rows(response.stdout)
        actual = rows[0].get('count') if len(rows) == 1 else None
        if not isinstance(actual, int) or (actual < count if modes[table] == 'insert_only'
                                           else actual != count):
            comparison = 'at least' if modes[table] == 'insert_only' else 'exactly'
            raise ValueError(f'{table}: expected {comparison} {count} rows; D1 returned {rows}')
    print('Verified D1 rows (insert_only counts are minimums): ' +
          ', '.join(f'{table}={n}' for table, n in expected.items()))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database', default='afpd-data', help='Existing remote D1 database name')
    parser.add_argument('--prepare-only', action='store_true',
                        help='Rebuild SQLite and SQL without contacting Cloudflare')
    parser.add_argument('--recreate-all', action='store_true',
                        help='Back up D1 and rebuild every table from JSON, replacing D1-only edits')
    args = parser.parse_args()
    modes = {table: 'recreate' for table in TABLES} if args.recreate_all else load_policy()
    if not args.prepare_only and not WRANGLER.is_file():
        parser.error('Wrangler is not installed; run npm ci first')
    LOCAL.mkdir(parents=True, exist_ok=True)
    run(sys.executable, str(HERE / 'create_afpd_db.py'), '--output', str(SQLITE), '--replace')
    expected = counts(SQLITE)
    write_import(SQLITE, IMPORT, modes)
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
    print(f'Applying table import policy to remote {args.database}', flush=True)
    run(str(WRANGLER), 'd1', 'execute', args.database, '--remote',
        f'--file={IMPORT}', '--yes')
    verify_remote(args.database, expected, modes)
    print(f'D1 upload complete. Pre-upload backup: {backup}', flush=True)


if __name__ == '__main__':
    main()
