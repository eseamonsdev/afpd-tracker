"""Replace afpd-data with a validated snapshot of afpd-data-staging.

Fixed direction, no database parameters, no production backup, no deployment.
The staging snapshot is retained under ignored db/local/ for retry/recovery.
"""

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sqlite3
import subprocess

ROOT = Path(__file__).resolve().parents[1]
WRANGLER = ROOT / 'node_modules/.bin/wrangler'
SOURCE = 'afpd-data-staging'
TARGET = 'afpd-data'


def identifier(value):
    return '"' + value.replace('"', '""') + '"'


def user_schema(connection):
    return [dict(zip(('type', 'name', 'sql'), row)) for row in connection.execute(
        "SELECT type,name,sql FROM sqlite_schema WHERE sql IS NOT NULL "
        "AND name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*' "
        "AND type IN ('table','index','view','trigger') ORDER BY type,name")]


def table_order(connection):
    tables = {entry['name'] for entry in user_schema(connection) if entry['type'] == 'table'}
    dependencies = {}
    for table in tables:
        parents = {row[2] for row in connection.execute(f'PRAGMA foreign_key_list({identifier(table)})')}
        # The legacy officers/names cycle is inserted with display_name_id NULL
        # and restored after every referenced name exists.
        if table == 'officers':
            parents.discard('officer_names')
        parents.discard(table)
        dependencies[table] = parents & tables
    ordered = []
    while dependencies:
        ready = sorted(table for table, parents in dependencies.items() if not parents)
        if not ready:
            raise ValueError('Unsupported foreign-key cycle; production was not changed')
        ordered.extend(ready)
        for table in ready:
            del dependencies[table]
        for parents in dependencies.values():
            parents.difference_update(ready)
    return ordered


def fingerprint(connection, table):
    columns = list(connection.execute(f'PRAGMA table_xinfo({identifier(table)})'))
    names = [row[1] for row in columns if row[6] == 0]
    order = [row[1] for row in sorted(columns, key=lambda row: row[5]) if row[5]] or names
    digest = hashlib.sha256()
    count = 0
    for row in connection.execute(f'SELECT {",".join(map(identifier, names))} FROM {identifier(table)} '
                                  f'ORDER BY {",".join(map(identifier, order))}'):
        values = [('blob', value.hex()) if isinstance(value, bytes) else value for value in row]
        digest.update(json.dumps(values, ensure_ascii=False, separators=(',', ':')).encode('utf-8'))
        digest.update(b'\n')
        count += 1
    return count, digest.hexdigest()


def prepare_promotion(source, destination_schema, output):
    """Rehearse a complete replacement locally before any production write."""
    schema = user_schema(source)
    if any('CREATE VIRTUAL TABLE' in row['sql'].upper() for row in schema):
        raise ValueError('Virtual tables need a dedicated migration; production was not changed')
    source_order = table_order(source)
    if 'radio_clips' not in source_order or source.execute('SELECT COUNT(*) FROM radio_clips').fetchone()[0] == 0:
        raise ValueError('Staging has no radio recordings; production was not changed')
    if source.execute('PRAGMA integrity_check').fetchone()[0] != 'ok' or source.execute('PRAGMA foreign_key_check').fetchone():
        raise ValueError('Staging snapshot failed integrity checks; production was not changed')
    with sqlite3.connect(':memory:') as rehearsal:
        # This is schema only, never a copy or backup of production data.
        for entry in sorted(destination_schema, key=lambda row: {'table': 0, 'index': 1, 'view': 2, 'trigger': 3}[row['type']]):
            rehearsal.execute(entry['sql'])
        destination_order = table_order(rehearsal)
        tables = {row['name']: row['sql'] for row in schema if row['type'] == 'table'}
        with output.open('w', encoding='utf-8') as stream:
            for entry in destination_schema:
                if entry['type'] in ('trigger', 'view'):
                    stream.write(f'DROP {entry["type"].upper()} IF EXISTS {identifier(entry["name"])};\n')
            if 'officers' in destination_order and any(row[1] == 'display_name_id' for row in rehearsal.execute('PRAGMA table_info(officers)')):
                stream.write('UPDATE officers SET display_name_id=NULL;\n')
            for table in reversed(destination_order):
                stream.write(f'DROP TABLE IF EXISTS {identifier(table)};\n')
            for table in source_order:
                stream.write(tables[table] + ';\n')
            display_updates = []
            for table in source_order:
                columns = [row[1] for row in source.execute(f'PRAGMA table_xinfo({identifier(table)})') if row[6] == 0]
                fields = ','.join(map(identifier, columns))
                quote_fields = ','.join(f'quote({identifier(name)})' for name in columns)
                for original in source.execute(f'SELECT {quote_fields} FROM {identifier(table)}'):
                    values = list(original)
                    if table == 'officers' and 'display_name_id' in columns:
                        pos = columns.index('display_name_id')
                        display_updates.append(f'UPDATE officers SET display_name_id={values[pos]} WHERE id={values[columns.index("id")]};\n')
                        values[pos] = 'NULL'
                    stream.write(f'INSERT INTO {identifier(table)} ({fields}) VALUES ({",".join(values)});\n')
            stream.writelines(display_updates)
            # Preserve AUTOINCREMENT identities even when the highest rows were deleted.
            if source.execute("SELECT 1 FROM sqlite_schema WHERE name='sqlite_sequence'").fetchone():
                stream.write('DELETE FROM sqlite_sequence;\n')
                for name, seq in source.execute('SELECT quote(name),quote(seq) FROM sqlite_sequence'):
                    stream.write(f'INSERT INTO sqlite_sequence(name,seq) VALUES ({name},{seq});\n')
            for entry in schema:
                if entry['type'] != 'table':
                    stream.write(entry['sql'] + ';\n')
        rehearsal.execute('PRAGMA foreign_keys=ON')
        rehearsal.executescript(output.read_text(encoding='utf-8'))
        if rehearsal.execute('PRAGMA foreign_key_check').fetchone():
            raise ValueError('Promotion rehearsal failed foreign-key checks; production was not changed')
        expected = {}
        for table in source_order:
            expected[table] = fingerprint(source, table)
            if fingerprint(rehearsal, table) != expected[table]:
                raise ValueError(f'Promotion rehearsal changed {table}; production was not changed')
    return {table: value[0] for table, value in expected.items()}


def run(*args, capture=False):
    return subprocess.run([str(WRANGLER), *args], cwd=ROOT, text=True,
                          capture_output=capture, check=True)


def query(database, sql, runner=run):
    result = json.loads(runner('d1', 'execute', database, '--remote', '--command', sql, '--json', capture=True).stdout)
    if isinstance(result, dict):
        result = [result]
    if not result or any(not item.get('success') for item in result):
        raise ValueError('D1 verification query failed')
    return result[0]['results']


def promote(directory, runner=run):
    directory.mkdir(parents=True, exist_ok=False)
    snapshot = directory / 'staging.sql'
    sql_file = directory / 'promote.sql'
    print(f'Exporting {SOURCE} to {snapshot}', flush=True)
    runner('d1', 'export', SOURCE, '--remote', f'--output={snapshot}', '--skip-confirmation')
    if not snapshot.is_file() or not snapshot.stat().st_size:
        raise ValueError('Staging export is empty; production was not changed')
    with sqlite3.connect(':memory:') as source:
        source.executescript(snapshot.read_text(encoding='utf-8'))
        destination = query(TARGET, "SELECT type,name,sql FROM sqlite_schema WHERE sql IS NOT NULL "
                            "AND name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*' "
                            "AND type IN ('table','index','view','trigger') ORDER BY type,name", runner)
        expected = prepare_promotion(source, destination, sql_file)
    print(f'Replacing {TARGET} from the staging snapshot; no production backup.', flush=True)
    runner('d1', 'execute', TARGET, '--remote', f'--file={sql_file}', '--yes')
    actual = query(TARGET, "SELECT name FROM sqlite_schema WHERE type='table' "
                   "AND name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*'", runner)
    if {row['name'] for row in actual} != set(expected):
        raise ValueError(f'Production tables differ from the snapshot. Retained files: {directory}')
    for table, count in expected.items():
        rows = query(TARGET, f'SELECT COUNT(*) AS count FROM {identifier(table)}', runner)
        if rows != [{'count': count}]:
            raise ValueError(f'Production verification failed for {table}. Retained files: {directory}')
    if query(TARGET, 'PRAGMA foreign_key_check', runner):
        raise ValueError(f'Production foreign-key verification failed. Retained files: {directory}')
    print(f'Promoted {SOURCE} to {TARGET}, including evidence reviews. Snapshot retained: {snapshot}', flush=True)


def main():
    argparse.ArgumentParser(description=__doc__).parse_args()
    if not WRANGLER.is_file():
        raise SystemExit('Wrangler is not installed; run npm ci first')
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    promote(ROOT / 'db/local' / f'promote-db-{stamp}')


if __name__ == '__main__':
    main()
