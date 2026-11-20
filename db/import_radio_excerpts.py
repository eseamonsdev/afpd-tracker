"""Import curated excerpt pages and ordered clip selections from entity JSON."""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXCERPTS = ROOT / 'data/entities/police-radio-excerpts'
ARCHIVES = ROOT / 'public/records/openmhz'
EXCERPT_FIELDS = {'id', 'type', 'number', 'slug', 'subtitle', 'description',
                  'enableTranscription', 'sections'}


def import_radio_excerpts(connection):
    files = sorted(EXCERPTS.glob('*.json'))
    if not files:
        raise ValueError(f'No radio excerpts found in {EXCERPTS}')
    manifests = {}
    excerpts = placements = 0
    for file in files:
        for excerpt in json.loads(file.read_text(encoding='utf-8'))['entities']:
            if excerpt.get('type') != 'police-radio-excerpt' or not excerpt.get('sections'):
                raise ValueError(f'Invalid radio excerpt in {file}')
            enabled = excerpt.get('enableTranscription', False)
            if not isinstance(enabled, bool):
                raise ValueError(f'Invalid transcript flag in {file}')
            extras = {key: value for key, value in excerpt.items() if key not in EXCERPT_FIELDS}
            connection.execute('''INSERT INTO radio_excerpts
                (id, number, slug, subtitle, description, transcripts_enabled,
                 source_file_path, extra_json) VALUES (?,?,?,?,?,?,?,?)''',
                (excerpt['id'], excerpt['number'], excerpt['slug'], excerpt['subtitle'],
                 excerpt.get('description'), int(enabled), file.relative_to(ROOT).as_posix(),
                 json.dumps(extras, ensure_ascii=False, sort_keys=True) if extras else None))
            excerpts += 1
            seen = set()
            previous_epoch = float('-inf')
            position = 0
            for section_number, section in enumerate(excerpt['sections'], 1):
                if not section.get('ranges'):
                    raise ValueError(f'Excerpt {excerpt["number"]} has an empty section')
                for range_number, span in enumerate(section['ranges'], 1):
                    day = span['date']
                    if day not in manifests:
                        archive = ARCHIVES / f'openmhz-afpd-car-to-car-{day}' / 'calls.json'
                        manifest = json.loads(archive.read_text(encoding='utf-8'))
                        if manifest['date'] != day or manifest['talkgroup'] != 6001:
                            raise ValueError(f'Invalid excerpt archive: {archive}')
                        calls = sorted(manifest['calls'], key=lambda call: call['epoch'])
                        filenames = [call['original_filename'] for call in calls]
                        if len(set(filenames)) != len(filenames):
                            raise ValueError(f'Duplicate filenames in {archive}')
                        manifests[day] = (calls, {name: i for i, name in enumerate(filenames)})
                    calls, indexes = manifests[day]
                    first = indexes.get(span['first'])
                    last = indexes.get(span.get('last', span['first']))
                    if first is None or last is None or last < first:
                        raise ValueError(f'Invalid boundaries in excerpt {excerpt["number"]}: {span}')
                    for call in calls[first:last + 1]:
                        if call['id'] in seen or call['epoch'] < previous_epoch:
                            raise ValueError(f'Overlapping or nonchronological excerpt {excerpt["number"]}')
                        clip = connection.execute('''SELECT id FROM radio_clips
                            WHERE id = ? AND archive_date = ? AND talkgroup_number = 6001
                              AND original_filename = ?''',
                            (call['id'], day, call['original_filename'])).fetchone()
                        if clip is None:
                            raise ValueError(f'Excerpt {excerpt["number"]} clip missing: {call["id"]}')
                        position += 1
                        connection.execute('''INSERT INTO radio_excerpt_clips
                            (excerpt_id, position, clip_id, section_number, section_title,
                             section_description, range_number) VALUES (?,?,?,?,?,?,?)''',
                            (excerpt['id'], position, call['id'], section_number,
                             section.get('title'), section.get('description'), range_number))
                        seen.add(call['id'])
                        previous_epoch = call['epoch']
                        placements += 1
    return excerpts, placements
