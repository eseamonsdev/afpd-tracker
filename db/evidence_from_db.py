"""Download or explicitly reupload association evidence, always on staging.

The JSON is independent of the public association builders and calls.json.
"""

import argparse
from datetime import date, datetime, timezone
import json
from pathlib import Path
import sqlite3
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
WRANGLER = ROOT / 'node_modules/.bin/wrangler'
DATABASE = 'afpd-data-staging'
OUTPUT = ROOT / 'data/db-evidenence-associations.json'
SCHEMA = ROOT / 'db/migrations/0007_association_evidence.sql'
TABLES = {
    'radio_associations': ('id', 'officer_key', 'officer_name', 'radio_id', 'source_status', 'website_visible', 'source_json'),
    'radio_association_evidence': ('id', 'association_id', 'archive_date', 'talkgroup_number', 'website_visible', 'source_json',
                                   'reviewed', 'correction_notes', 'revision', 'updated_at', 'updated_by'),
    'radio_association_evidence_clips': ('evidence_id', 'clip_id', 'position', 'speaker_confirmed'),
    'radio_association_assignments': ('id', 'kind', 'source_json'),
}


def rows_from_db(connection):
    for table, columns in TABLES.items():
        actual = {row[1] for row in connection.execute(f'PRAGMA table_info({table})')}
        if actual != set(columns):
            raise ValueError(f'Unsupported or missing evidence schema for {table}; no snapshot was written')
    return {table: [dict(zip(columns, row)) for row in connection.execute(
        f'SELECT {",".join(columns)} FROM {table} ORDER BY {",".join(columns[:2])}')]
        for table, columns in TABLES.items()}


def snapshot_from_rows(rows):
    """Include every row, including hidden, unreviewed and empty groups."""
    radios, associations, groups = {}, {}, {}
    for row in rows['radio_associations']:
        association = {key: row[key] for key in ('id', 'officer_name', 'source_status')}
        association.update(officer_id=row['officer_key'], website_visible=bool(row['website_visible']),
                           source=json.loads(row['source_json']), evidence=[])
        radios.setdefault(row['radio_id'], {'associations': []})['associations'].append(association)
        associations[row['id']] = association
    for row in rows['radio_association_evidence']:
        group = {key: row[key] for key in ('id', 'correction_notes', 'revision', 'updated_at', 'updated_by')}
        group.update(date=row['archive_date'], talkgroup=row['talkgroup_number'],
                     website_visible=bool(row['website_visible']), reviewed=bool(row['reviewed']),
                     source_records=json.loads(row['source_json']), clips=[])
        associations[row['association_id']]['evidence'].append(group)
        groups[row['id']] = group
    for row in rows['radio_association_evidence_clips']:
        groups[row['evidence_id']]['clips'].append({'id': row['clip_id'], 'position': row['position'],
                                                   'speaker_confirmed': bool(row['speaker_confirmed'])})
    for association in associations.values():
        association['evidence'].sort(key=lambda g: (g['date'], g['talkgroup'], g['id']))
    for group in groups.values():
        group['clips'].sort(key=lambda c: (c['position'], c['id']))
    for radio in radios.values():
        radio['associations'].sort(key=lambda a: (a['officer_id'], a['id']))
    assignments = [{'id': r['id'], 'kind': r['kind'], 'source': json.loads(r['source_json'])}
                   for r in sorted(rows['radio_association_assignments'], key=lambda r: r['id'])]
    return {'format': 'afpd-association-evidence', 'schema_version': 1, 'database': DATABASE,
            'radio_ids': dict(sorted(radios.items())), 'assignments': assignments}


def fields(value, expected):
    if not isinstance(value, dict) or set(value) != set(expected.split()):
        raise ValueError(f'Expected fields: {expected}')


def text(value, nullable=False):
    if value is None and nullable:
        return value
    if not isinstance(value, str) or '\0' in value:
        raise ValueError('Expected a string without NUL characters')
    return value


def integer(value, minimum=0):
    if type(value) is not int or value < minimum or value > 2**53 - 1:
        raise ValueError('Expected a nonnegative safe integer')
    return value


def flag(value):
    if type(value) is not bool:
        raise ValueError('Review, visibility and confirmation flags must be true or false')
    return int(value)


def sequence(value):
    if not isinstance(value, list):
        raise ValueError('Expected a list')
    return value


def source(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False)


def rows_from_snapshot(document):
    fields(document, 'format schema_version database radio_ids assignments')
    if document['format'] != 'afpd-association-evidence' or type(document['schema_version']) is not int or document['schema_version'] != 1:
        raise ValueError('Unsupported evidence snapshot format or version')
    if document['database'] != DATABASE:
        raise ValueError('Evidence snapshots must be for afpd-data-staging')
    if not isinstance(document['radio_ids'], dict):
        raise ValueError('radio_ids must be an object keyed by radio ID')
    rows = {table: [] for table in TABLES}
    for radio_id, radio in document['radio_ids'].items():
        if not text(radio_id).isascii() or not radio_id.isdigit() or radio_id.startswith('0'):
            raise ValueError('Invalid radio ID')
        fields(radio, 'associations')
        for association in sequence(radio['associations']):
            fields(association, 'id officer_id officer_name source_status website_visible source evidence')
            rows['radio_associations'].append(dict(zip(TABLES['radio_associations'], (
                text(association['id']), text(association['officer_id']), text(association['officer_name']), radio_id,
                text(association['source_status']), flag(association['website_visible']), source(association['source'])))))
            for group in sequence(association['evidence']):
                fields(group, 'id date talkgroup website_visible reviewed correction_notes revision updated_at updated_by source_records clips')
                if date.fromisoformat(text(group['date'])).isoformat() != group['date']:
                    raise ValueError('Evidence dates must use YYYY-MM-DD')
                if not isinstance(group['source_records'], list):
                    raise ValueError('source_records must be a list')
                rows['radio_association_evidence'].append(dict(zip(TABLES['radio_association_evidence'], (
                    text(group['id']), association['id'], group['date'], integer(group['talkgroup'], 1),
                    flag(group['website_visible']), source(group['source_records']), flag(group['reviewed']),
                    text(group['correction_notes']), integer(group['revision']), text(group['updated_at'], True),
                    text(group['updated_by'], True)))))
                for clip in sequence(group['clips']):
                    fields(clip, 'id position speaker_confirmed')
                    rows['radio_association_evidence_clips'].append(dict(zip(TABLES['radio_association_evidence_clips'], (
                        group['id'], text(clip['id']), integer(clip['position'], 1), flag(clip['speaker_confirmed'])))))
    for assignment in sequence(document['assignments']):
        fields(assignment, 'id kind source')
        rows['radio_association_assignments'].append(dict(zip(TABLES['radio_association_assignments'], (
            text(assignment['id']), text(assignment['kind']), source(assignment['source'])))))
    # Real constraints detect duplicate IDs, duplicate natural keys and broken
    # relationships before an output file or remote database is changed.
    with sqlite3.connect(':memory:') as rehearsal:
        rehearsal.execute('PRAGMA foreign_keys=ON')
        rehearsal.executescript(SCHEMA.read_text())
        for table, columns in TABLES.items():
            rehearsal.executemany(f'INSERT INTO {table} ({",".join(columns)}) VALUES ({",".join("?" for _ in columns)})',
                                  [tuple(row[c] for c in columns) for row in rows[table]])
    return rows


def write_snapshot(document, path=OUTPUT):
    rows_from_snapshot(document)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(document, ensure_ascii=False, indent=2, allow_nan=False) + '\n', encoding='utf-8')
    temporary.replace(path)


def quote(value):
    return 'NULL' if value is None else str(value) if isinstance(value, int) else "'" + value.replace("'", "''") + "'"


def restore_sql(document):
    """Restore represented groups; keep groups added after the downloaded file."""
    rows = rows_from_snapshot(document)
    statements = []
    for table, columns in TABLES.items():
        if table == 'radio_association_evidence_clips':
            for group in rows['radio_association_evidence']:
                statements.append(f"DELETE FROM {table} WHERE evidence_id={quote(group['id'])};")
        for row in rows[table]:
            sql = f'INSERT INTO {table} ({",".join(columns)}) VALUES ({",".join(quote(row[c]) for c in columns)})'
            if table != 'radio_association_evidence_clips':
                updates = [f'{c}=excluded.{c}' for c in columns if c != 'id']
                if table == 'radio_association_evidence':
                    updates[columns[1:].index('revision')] = f'revision=MAX({table}.revision,excluded.revision)+1'
                sql += ' ON CONFLICT(id) DO UPDATE SET ' + ','.join(updates)
            statements.append(sql + ';')
    return '\n'.join(statements) + '\n'


def run(*args):
    subprocess.run([str(WRANGLER), *args], cwd=ROOT, check=True)


def download_connection(directory, runner=run):
    dump = directory / 'staging.sql'
    runner('d1', 'export', DATABASE, '--remote', f'--output={dump}', '--skip-confirmation',
           '--table', *TABLES)
    connection = sqlite3.connect(':memory:')
    try:
        connection.executescript(dump.read_text(encoding='utf-8'))
        return connection
    except Exception:
        connection.close()
        raise


def upload(document, directory, runner=run):
    sql = restore_sql(document)  # Validate before reading or writing remote data.
    directory.mkdir(parents=True, exist_ok=False)
    connection = download_connection(directory, runner)
    try:
        write_snapshot(snapshot_from_rows(rows_from_db(connection)), directory / 'before-evidence-upload.json')
        connection.execute('PRAGMA foreign_keys=ON')
        connection.executescript(sql)
        # Rehearse on the current staging schema, including natural-key conflicts.
        if connection.execute('PRAGMA foreign_key_check').fetchone():
            raise ValueError('Evidence upload rehearsal failed foreign-key checks')
    finally:
        connection.close()
    sql_file = directory / 'evidence-upload.sql'
    sql_file.write_text(sql, encoding='utf-8')
    if sql.strip():
        runner('d1', 'execute', DATABASE, '--remote', f'--file={sql_file}', '--yes')
    print(f'Evidence uploaded to staging. Pre-upload snapshot retained: {directory}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--upload', action='store_true', help='Explicitly restore the evidence JSON to staging')
    args = parser.parse_args()
    if not WRANGLER.is_file():
        parser.error('Wrangler is not installed; run npm ci first')
    if args.upload:
        document = json.loads(OUTPUT.read_text(encoding='utf-8'))
        stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
        upload(document, ROOT / 'db/local' / f'evidence-upload-{stamp}')
    else:
        with tempfile.TemporaryDirectory() as directory:
            connection = download_connection(Path(directory))
            try:
                document = snapshot_from_rows(rows_from_db(connection))
                write_snapshot(document)
            finally:
                connection.close()
        counts = {table: len(rows) for table, rows in rows_from_snapshot(document).items()}
        print(f'Saved all staging evidence to {OUTPUT.relative_to(ROOT)}: {counts}')


if __name__ == '__main__':
    main()
