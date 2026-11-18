"""Create a reproducible, local SQLite preview from the tracked officer entities.

This imports existing name forms, never rewrites the website's source files.
The SQL schema is compatible with a future Cloudflare D1 migration.
"""

import argparse
import json
from pathlib import Path
import re
import sqlite3
from import_radio import import_radio

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'data/entities/people/officers'
SCHEMA = Path(__file__).resolve().parent / 'migrations/0001_officer_names.sql'
RADIO_SCHEMA = Path(__file__).resolve().parent / 'migrations/0002_radio.sql'
DEFAULT_OUTPUT = Path(__file__).resolve().parent / 'local/afpd.sqlite'

# These aliases have explicit officer identification in the radio evidence.
# Do not infer aliases from unresolved radio search cues.
RADIO_ALIASES = {
    'tanner-m-ballamis': ('T-Ball', 'G-Ball'),
}
# Tavo is an attested shortened given name for David Octavio Guerra, not a radio alias.
CONFIRMED_SHORT_NAMES = {
    'david-o-guerra': ('Tavo',),
}
RADIO_EVIDENCE = 'data/officer-association-evidence.json'


def forward_name(name):
    """The entity's canonical name uses 'Family, Given Middle' order."""
    parts = name.split(', ', 1)
    return f'{parts[1]} {parts[0]}' if len(parts) == 2 else name


def name_parts(name, kind):
    """Fill parts only where a simple form is unambiguous; never invent parts."""
    if kind != 'personal_name' or '(' in name or ')' in name:
        return (None, None, None)
    words = name.split()
    if len(words) == 1:
        return (words[0], None, None)
    if not 2 <= len(words) <= 3:
        return (None, None, None)
    return (words[0], words[1] if len(words) == 3 else None, words[-1])


def read_officers():
    for file in sorted(SOURCE.glob('*.json')):
        entities = json.loads(file.read_text(encoding='utf-8'))['entities']
        if len(entities) != 1 or entities[0].get('type') != 'person' or 'officer' not in entities[0].get('roles', []):
            raise ValueError(f'Expected one officer entity: {file}')
        yield file.stem, file.relative_to(ROOT).as_posix(), entities[0]


def import_data(connection):
    count = 0
    with connection:
        for officer_id, (slug, path, entity) in enumerate(read_officers(), start=1):
            connection.execute(
                'INSERT INTO officers (id, legacy_entity_id, url_slug) VALUES (?, ?, ?)',
                (officer_id, entity['id'], slug),
            )
            display = entity.get('display_name') or forward_name(entity['name'])
            forms = {}

            def include(text, field, kind='personal_name', source=path):
                text = text.strip()
                if field == 'alternate_names':
                    text = re.sub(r'\s*\(nickname\)$', '', text, flags=re.IGNORECASE)
                if not text:
                    raise ValueError(f'Empty name in {source}:{field}')
                key = text.casefold()
                if key not in forms:
                    forms[key] = {'name': text, 'kind': kind, 'source': source, 'fields': set()}
                forms[key]['fields'].add(field)

            include(display, 'display_name' if entity.get('display_name') else 'name')
            include(forward_name(entity['name']), 'name')
            for field in ('alternate_names', 'search_names'):
                for text in entity.get(field, []):
                    if text.startswith('Officer '):
                        continue  # Search phrasing is not a distinct name form.
                    include(text, field)
            for alias in RADIO_ALIASES.get(slug, ()):
                include(alias, 'confirmed_radio_alias', 'radio_alias', RADIO_EVIDENCE)
            for short_name in CONFIRMED_SHORT_NAMES.get(slug, ()):
                include(short_name, 'confirmed_short_name', 'personal_name', RADIO_EVIDENCE)

            selected = None
            for form in forms.values():
                given, middle, family = name_parts(form['name'], form['kind'])
                cursor = connection.execute(
                    '''INSERT INTO officer_names
                       (officer_id, name_text, given_name, middle_names, family_name,
                        kind, source_path, source_fields)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?)''',
                    (officer_id, form['name'], given, middle, family, form['kind'],
                     form['source'], ','.join(sorted(form['fields']))),
                )
                count += 1
                if form['name'].casefold() == display.casefold():
                    selected = cursor.lastrowid
            if selected is None:
                raise ValueError(f'No display name for {slug}')
            connection.execute('UPDATE officers SET display_name_id = ? WHERE id = ?', (selected, officer_id))
    return officer_id, count


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument('--replace', action='store_true', help='Replace an existing local preview')
    args = parser.parse_args()
    output = args.output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    if output.exists():
        if not args.replace:
            parser.error(f'{output} already exists; pass --replace to rebuild it')
        output.unlink()
    connection = sqlite3.connect(output)
    try:
        connection.execute('PRAGMA foreign_keys = ON')
        connection.executescript(SCHEMA.read_text(encoding='utf-8'))
        connection.executescript(RADIO_SCHEMA.read_text(encoding='utf-8'))
        officers, names = import_data(connection)
        with connection:
            archives, clips, sources = import_radio(connection)
        violations = connection.execute('PRAGMA foreign_key_check').fetchall()
        if violations:
            raise ValueError(f'Foreign key violations: {violations}')
        print(f'Created {output}: {officers} officers, {names} name forms; '
              f'{archives} radio days, {clips} clips, {sources} clip sources')
    except Exception:
        connection.close()
        output.unlink(missing_ok=True)
        raise
    finally:
        connection.close()


if __name__ == '__main__':
    main()
