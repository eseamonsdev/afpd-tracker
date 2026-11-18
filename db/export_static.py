"""Export the local officer-name preview as a read-only static /db/ page."""

import json
from pathlib import Path
import shutil

from serve import DEFAULT_DB, HERE, TABLES, query_database

OUTPUT = HERE.parent / 'public/db'


def main():
    if not DEFAULT_DB.is_file():
        raise SystemExit('Create the local database first: python3 db/import_officer_names.py --replace')
    OUTPUT.mkdir(parents=True, exist_ok=True)
    snapshot = {}
    for table in TABLES:
        first = query_database(DEFAULT_DB, table, limit=100)
        rows = first['rows']
        for offset in range(100, first['total'], 100):
            rows.extend(query_database(DEFAULT_DB, table, offset=offset, limit=100)['rows'])
        if len(rows) != first['total']:
            raise ValueError(f'Incomplete export for {table}')
        snapshot[table] = {'columns': first['columns'], 'rows': rows}
    (OUTPUT / 'snapshot.json').write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    shutil.copyfile(HERE / 'index.html', OUTPUT / 'index.html')
    print(f'Exported {OUTPUT}: {len(snapshot["officers"]["rows"])} officers, '
          f'{len(snapshot["officer_names"]["rows"])} names')


if __name__ == '__main__':
    main()
