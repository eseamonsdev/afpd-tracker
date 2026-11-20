"""Import source references from entity JSON without altering entity relationships."""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENTITIES = ROOT / 'data/entities'


def pointer_segment(segment):
    return str(segment).replace('~', '~0').replace('/', '~1')


def import_entity_source_links(connection):
    files = sorted(ENTITIES.rglob('*.json'))
    if not files:
        raise ValueError(f'No entity JSON files found in {ENTITIES}')
    source_ids = {row[0] for row in connection.execute('SELECT source_id FROM sources')}
    entities = []
    entity_ids = set()
    for file in files:
        for entity in json.loads(file.read_text(encoding='utf-8')).get('entities', []):
            entity_id = entity['id']
            if entity_id in entity_ids:
                raise ValueError(f'Duplicate entity ID: {entity_id}')
            entity_ids.add(entity_id)
            entities.append((file, entity))

    count = 0
    for file, entity in entities:
        def visit(value, parts):
            nonlocal count
            if isinstance(value, dict):
                if '$ref' in value:
                    target = value['$ref']
                    if target in source_ids:
                        if not parts:
                            raise ValueError(f'Root source reference in {file}')
                        connection.execute('''INSERT INTO entity_source_links
                            (entity_id, entity_type, entity_file_path, source_id,
                             reference_path, field_name, reference_json)
                            VALUES (?,?,?,?,?,?,?)''',
                            (entity['id'], entity['type'], file.relative_to(ROOT).as_posix(),
                             target, '/' + '/'.join(pointer_segment(part) for part in parts),
                             str(parts[0]), json.dumps(value, ensure_ascii=False,
                                                      sort_keys=True, separators=(',', ':'))))
                        count += 1
                    elif target not in entity_ids:
                        raise ValueError(f'Unresolved reference in {file}: {target}')
                for key, child in value.items():
                    visit(child, (*parts, key))
            elif isinstance(value, list):
                for index, child in enumerate(value):
                    visit(child, (*parts, index))

        visit(entity, ())
    return count
