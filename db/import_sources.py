"""Import individual records from data/sources into the sources table."""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = ROOT / 'data/sources'
FIELDS = {
    'id', 'type', 'label', 'url', 'path', 'publisher', 'channel',
    'publishedDate', 'description', 'durationSeconds',
}


def import_sources(connection):
    files = sorted(SOURCE_DIR.rglob('*.json'))
    if not files:
        raise ValueError(f'No source JSON files found in {SOURCE_DIR}')
    count = 0
    for file in files:
        data = json.loads(file.read_text(encoding='utf-8'))
        if not isinstance(data, dict):
            raise ValueError(f'Expected a source collection object: {file}')
        for group, records in data.items():
            if not isinstance(records, list):
                raise ValueError(f'Expected an array at {file}:{group}')
            for record in records:
                if not isinstance(record, dict):
                    raise ValueError(f'Expected a source object at {file}:{group}')
                if not all(isinstance(record.get(key), str) and record[key].strip()
                           for key in ('id', 'type', 'label')):
                    raise ValueError(f'Missing source id, type, or label at {file}:{group}')
                extras = {key: value for key, value in record.items() if key not in FIELDS}
                connection.execute('''INSERT INTO sources
                    (source_id, source_type, label, url, file_path, publisher, channel,
                     published_date, description, duration_seconds, extra_json, source_file_path)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)''',
                    (record['id'], record['type'], record['label'], record.get('url'),
                     record.get('path'), record.get('publisher'), record.get('channel'),
                     record.get('publishedDate'), record.get('description'),
                     record.get('durationSeconds'),
                     json.dumps(extras, ensure_ascii=False, sort_keys=True, separators=(',', ':'))
                     if extras else None,
                     file.relative_to(ROOT).as_posix()))
                count += 1
    return count
