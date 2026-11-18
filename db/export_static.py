"""Export the local SQLite preview as a read-only static /db/ page."""

import json
import gzip
from pathlib import Path
import shutil
import sqlite3

from serve import DEFAULT_DB, HERE, TABLES, RADIO_EVENTS, query_database

OUTPUT = HERE.parent / 'public/db'


def main():
    if not DEFAULT_DB.is_file():
        raise SystemExit('Create the local database first: python3 db/import_officer_names.py --replace')
    OUTPUT.mkdir(parents=True, exist_ok=True)
    snapshot = {}
    for table in TABLES:
        if table in RADIO_EVENTS:
            continue
        first = query_database(DEFAULT_DB, table, limit=1000)
        rows = first['rows']
        for offset in range(1000, first['total'], 1000):
            rows.extend(query_database(DEFAULT_DB, table, offset=offset, limit=1000)['rows'])
        if len(rows) != first['total']:
            raise ValueError(f'Incomplete export for {table}')
        snapshot[table] = {'columns': first['columns'], 'rows': rows}
    chunk_dir = OUTPUT / 'radio'
    if chunk_dir.exists():
        shutil.rmtree(chunk_dir)
    chunk_dir.mkdir()
    snapshot['_radio_chunks'] = []
    with sqlite3.connect(f'file:{DEFAULT_DB}?mode=ro', uri=True) as connection:
        connection.row_factory = sqlite3.Row
        periods = connection.execute('''SELECT DISTINCT substr(archive_date,1,7) AS month,
            talkgroup_number AS talkgroup FROM radio_clips ORDER BY month DESC, talkgroup''').fetchall()
        for period in periods:
            month, talkgroup = period['month'], period['talkgroup']
            # Each asset stays below the static host's per-file limit.
            for first, last in ((1, 10), (11, 20), (21, 31)):
                start, end = f'{month}-{first:02d}', f'{month}-{last:02d}'
                contents = {}
                for table, sql in (
                    ('radio_clips', '''SELECT * FROM radio_clips WHERE archive_date BETWEEN ? AND ?
                        AND talkgroup_number = ? ORDER BY archive_date, clip_number'''),
                    ('radio_clip_sources', '''SELECT s.*, c.archive_date, c.talkgroup_number,
                        c.clip_number FROM radio_clip_sources s JOIN radio_clips c ON c.id = s.clip_id
                        WHERE c.archive_date BETWEEN ? AND ? AND c.talkgroup_number = ?
                        ORDER BY c.archive_date, c.clip_number, s.radio_id'''),
                ):
                    cursor = connection.execute(sql, (start, end, talkgroup))
                    columns = [col[0] for col in cursor.description]
                    contents[table] = {'columns': columns,
                                       'rows': [[row[column] for column in columns] for row in cursor]}
                if not contents['radio_clips']['rows']:
                    continue
                filename = f'radio/{month}-{talkgroup}-{first:02d}.bin'
                data = json.dumps(contents, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
                (OUTPUT / filename).write_bytes(gzip.compress(data, compresslevel=9, mtime=0))
                snapshot['_radio_chunks'].append({'month': month, 'talkgroup': talkgroup,
                    'file': filename, 'clips': len(contents['radio_clips']['rows']),
                    'sources': len(contents['radio_clip_sources']['rows'])})
    (OUTPUT / 'snapshot.json').write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    shutil.copyfile(HERE / 'index.html', OUTPUT / 'index.html')
    print(f'Exported {OUTPUT}: {len(snapshot["officers"]["rows"])} officers, '
          f'{len(snapshot["officer_names"]["rows"])} names, '
          f'{sum(c["clips"] for c in snapshot["_radio_chunks"])} radio clips in '
          f'{len(snapshot["_radio_chunks"])} chunks')


if __name__ == '__main__':
    main()
