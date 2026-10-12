#!/usr/bin/env python3
"""Standardize Car-to-Car archive metadata without downloading or modifying audio."""
import argparse
import hashlib
import json
import math
from pathlib import Path

from download_openmhz_manifest import (
    SCHEMA_VERSION, archive_readme, coverage_metadata, day_bounds, inspect_audio,
    normalize_call_metadata, timezone, write_json,
)


def utc_text(instant):
    return instant.astimezone(timezone.utc).isoformat().replace('+00:00', 'Z') if instant else None


def standardized_files(folder):
    data = json.loads((folder / 'calls.json').read_text())
    day = data['date']
    validation_path = folder / 'validation.json'
    validation = json.loads(validation_path.read_text()) if validation_path.exists() else {}
    reports = {item['filename']: item for item in validation.get('files', [])}
    checks = {}
    calls = []
    for entry in data['calls']:
        call = normalize_call_metadata(entry, day)
        name = call['original_filename']
        if name in checks:
            raise ValueError(f'Duplicate audio entry: {name}')
        audio = folder / name
        content = audio.read_bytes()
        if len(content) < 12 or content[4:8] != b'ftyp':
            raise ValueError(f'Invalid M4A: {audio}')
        digest = hashlib.sha256(content).hexdigest()
        report = reports.get(name, {})
        expected_digest = call.get('sha256') or report.get('sha256')
        if expected_digest and expected_digest != digest:
            raise ValueError(f'Audio checksum mismatch: {audio}')
        duration = call.get('audio_duration_seconds', report.get('actual_duration_seconds'))
        if duration is None:
            checked = inspect_audio(audio, call)
        else:
            if not math.isfinite(duration) or duration <= 0:
                raise ValueError(f'Invalid saved audio duration: {audio}')
            checked = {'size_bytes': len(content), 'sha256': digest, 'audio_duration_seconds': duration}
        checked['source_duration_matches'] = abs(checked['audio_duration_seconds'] - call['displayed_seconds']) <= 1
        call.update(checked)
        checks[name] = checked
        calls.append(call)
    calls.sort(key=lambda call: (call['epoch'], call['id']))
    duplicates = [normalize_call_metadata(call, day) for call in data.get('duplicate_source_calls', [])]
    for duplicate in duplicates:
        duplicate.update(checks[duplicate['original_filename']])
    coverage, cutoff = coverage_metadata(data, day)
    start, end = day_bounds(day)
    data.update(schema_version=SCHEMA_VERSION, timezone='America/Denver', system='dcfems', talkgroup=6001,
                count=len(calls), source_call_count=len(calls) + len(duplicates), calls=calls,
                start_utc=utc_text(start), end_utc_exclusive=utc_text(end), coverage=coverage,
                collected_through_utc=utc_text(cutoff))
    if duplicates:
        data['duplicate_source_calls'] = duplicates
    validation.update(schema_version=SCHEMA_VERSION, date=day, timezone='America/Denver', system='dcfems',
                      talkgroup=6001, count=len(calls), source_call_count=data['source_call_count'],
                      validated=True, coverage=coverage, collected_through_utc=data['collected_through_utc'])
    # Unknown historical download counts/timing stay null; never invent them.
    validation.setdefault('downloaded', None)
    validation.setdefault('skipped_existing', None)
    validation.setdefault('minimum_pause_after_download_seconds', validation.get('download_delay_seconds'))
    validation['source_duration_discrepancies'] = [call['original_filename'] for call in calls
                                                  if not call['source_duration_matches']]
    outputs = {'calls.json': data, 'validation.json': validation, 'rows.json': [call.get('row', '') for call in calls]}
    outputs['README.txt'] = archive_readme(data)
    readme_path = folder / 'README.txt'
    if readme_path.exists() and readme_path.read_text() != outputs['README.txt'] and not (folder / 'legacy-README.txt').exists():
        outputs['legacy-README.txt'] = readme_path.read_text()
    original_rows_path = folder / 'rows.json'
    if original_rows_path.exists():
        original_rows = json.loads(original_rows_path.read_text())
        if original_rows != outputs['rows.json'] and not (folder / 'legacy-rows.json').exists():
            outputs['legacy-rows.json'] = original_rows
    return outputs


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path.cwd())
    parser.add_argument('--check', action='store_true', help='Fail if standard metadata needs updating')
    args = parser.parse_args()
    prepared = []
    for folder in sorted((args.root / 'public/records/openmhz').glob('openmhz-afpd-car-to-car-*')):
        if folder.is_dir() and (folder / 'calls.json').exists():
            prepared.append((folder, standardized_files(folder)))
    # Finish validation before changing any file.
    changes = 0
    for folder, outputs in prepared:
        for name, data in outputs.items():
            path = folder / name
            existing = path.read_text() if path.exists() else None
            if existing is not None and name.endswith('.json'):
                existing = json.loads(existing)
            if existing != data:
                if args.check:
                    raise ValueError(f'Metadata needs standardization: {path}')
                if name.endswith('.json'):
                    write_json(path, data)
                else:
                    path.write_text(data)
                changes += 1
    print(f'Verified {len(prepared)} Car-to-Car archives; updated {changes} metadata files.')


if __name__ == '__main__':
    main()
