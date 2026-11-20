"""Import archived OpenMHz calls into the local SQLite preview.

Use the archive's R2 storage reference; expiring OpenMHz media URLs are not copied.
"""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ARCHIVES = ROOT / 'public/records/openmhz'
TALKGROUP_NAMES = {5922: 'Law 2 Northeast', 6001: 'American Fork PD Car to Car',
                   6036: 'American Fork Police'}
INVALID_RADIO_IDS = {'-1', '0', '1'}


def flag(value):
    return None if value is None else int(bool(value))


def day_indexes():
    indexes = {}
    for group, filename in ((5922, 'law-2-index.json'), (6001, 'index.json')):
        data = json.loads((ARCHIVES / filename).read_text(encoding='utf-8'))
        days = {}
        for entry in data['days']:
            if entry['date'] in days:
                raise ValueError(f'Duplicate {filename} date: {entry["date"]}')
            days[entry['date']] = entry
        indexes[group] = days
    return indexes


DAY_FIELDS = {'date', 'timezone', 'system', 'talkgroup', 'talkgroup_name',
              'start_utc', 'end_utc_exclusive', 'count', 'source_call_count',
              'coverage', 'coverage_note', 'collected_through_utc',
              'download_failure_count', 'enableTranscription', 'calls'}


def import_radio(connection):
    files = sorted(ARCHIVES.glob('*/calls.json'))
    if not files:
        raise ValueError(f'No calls.json archives found in {ARCHIVES}')
    indexes = day_indexes()
    clips = sources = 0
    for file in files:
        archive = json.loads(file.read_text(encoding='utf-8'))
        system, group, day = archive['system'], archive['talkgroup'], archive['date']
        name = archive.get('talkgroup_name') or TALKGROUP_NAMES.get(group)
        if not name:
            name = next((c.get('talkgroup_name') for c in archive['calls']
                         if c.get('talkgroup_name')), str(group))
        connection.execute('INSERT OR IGNORE INTO radio_talkgroups VALUES (?, ?, ?)',
                           (system, group, name))
        path = file.relative_to(ROOT).as_posix()
        entry = indexes.get(group, {}).get(day)
        if entry and (entry['folder'] != file.parent.name or entry['count'] != len(archive['calls'])):
            raise ValueError(f'Index does not match archive {path}')
        if archive['count'] != len(archive['calls']):
            raise ValueError(f'Archive count does not match calls in {path}')
        for source, value in (('archive', archive.get('enableTranscription')),
                              ('index', entry.get('enableTranscription') if entry else None),
                              ('index day', entry.get('enableDay') if entry else None)):
            if value is not None and not isinstance(value, bool):
                raise ValueError(f'Invalid {source} flag in {path}')
        player_enabled = int(entry is not None and (group != 5922 or entry.get('enableDay') is True))
        transcripts_enabled = int((entry.get('enableTranscription') if group == 5922 and entry
                                   else archive.get('enableTranscription')) is True)
        extras = {key: value for key, value in archive.items() if key not in DAY_FIELDS}
        connection.execute('''INSERT INTO radio_archive_days
            (system, talkgroup_number, archive_date, archive_path, timezone,
             start_utc, end_utc_exclusive, clip_count, source_call_count,
             coverage, coverage_note, collected_through_utc, download_failure_count,
             player_enabled, transcripts_enabled, extra_json)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)''',
            (system, group, day, path, archive['timezone'], archive.get('start_utc'),
             archive.get('end_utc_exclusive'), len(archive['calls']),
             archive.get('source_call_count'), archive.get('coverage'),
             (entry.get('coverageNote') if entry and 'coverageNote' in entry
              else archive.get('coverage_note')),
             archive.get('collected_through_utc'), archive.get('download_failure_count'),
             player_enabled, transcripts_enabled,
             json.dumps(extras, ensure_ascii=False, sort_keys=True) if extras else None))
        for number, call in enumerate(archive['calls'], start=1):
            if call['talkgroup'] != group:
                raise ValueError(f'Talkgroup mismatch in {path} clip {number}')
            storage = call.get('audio_storage') or {}
            connection.execute('''INSERT INTO radio_clips
                (id, system, talkgroup_number, archive_date, clip_number, timestamp_utc,
                 original_filename, displayed_seconds, audio_duration_seconds,
                 frequency_hz, emergency, transcript, original_transcript,
                 transcript_validated, needs_review, audio_provider, audio_bucket, audio_key,
                 audio_sha256, audio_size_bytes, audio_verified, audio_downloaded,
                 source_duration_matches, archive_path)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)''',
                (call['id'], system, group, day, number, call['timestamp_utc'],
                 call.get('original_filename'),
                 call.get('displayed_seconds'), call.get('audio_duration_seconds'),
                 call.get('frequency_hz', call.get('freq')),
                 flag(call.get('emergency')),
                 call.get('transcript'), call.get('original_transcript'),
                 int(call.get('validated') is True), flag(call.get('needs_review')),
                 storage.get('provider'), storage.get('bucket'), storage.get('key'),
                 storage.get('sha256'), storage.get('size_bytes'),
                 flag(storage.get('verified')), flag(call.get('audio_downloaded')),
                 flag(call.get('source_duration_matches')), path))
            clips += 1
            positions = {str(src['src']): src.get('pos') for src in (call.get('srcList') or [])
                         if isinstance(src, dict) and src.get('src') is not None}
            for radio_id in dict.fromkeys(str(value) for value in (call.get('radio_ids') or [])):
                if radio_id in INVALID_RADIO_IDS:
                    continue
                connection.execute('INSERT OR IGNORE INTO radio_ids(radio_id) VALUES (?)', (radio_id,))
                connection.execute('INSERT INTO radio_clip_radio_ids VALUES (?, ?, ?)',
                                   (call['id'], radio_id, positions.get(radio_id)))
                sources += 1
    return len(files), clips, sources
