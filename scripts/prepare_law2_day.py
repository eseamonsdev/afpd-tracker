#!/usr/bin/env python3
"""Prepare one Law 2 day from preserved metadata without retrying known failures."""
import argparse
import json
from datetime import date
from pathlib import Path

from r2_audio import stored_audio
from download_openmhz_manifest import validate_manifest, write_json


def prepare(root, day):
    if not date(2026, 10, 2) <= date.fromisoformat(day) <= date(2026, 10, 15):
        raise ValueError('This queue is limited to October 2–15, 2026')
    pending = root / 'records-pending-review/openmhz-manifests' / f'{day}-law-2.json'
    if pending.exists():
        validate_manifest(json.loads(pending.read_text()))
        return {'date': day, 'resuming': True}
    source = root / 'records-pending-review/openmhz-metadata/law-2' / day / 'calls.json'
    data = json.loads(source.read_text())
    if data.get('date') != day or data.get('talkgroup') != 5922:
        raise ValueError('Preserved metadata does not match the requested Law 2 day')
    if data.get('count') != len(data['calls']):
        raise ValueError('Preserved metadata count does not match its calls')
    archive = root / 'public/records/openmhz' / f'openmhz-afpd-law-2-{day}'
    existing_path = archive / 'calls.json'
    existing = json.loads(existing_path.read_text()) if existing_path.exists() else {}
    saved = {c['original_filename'] for c in existing.get('calls', [])
             if (archive / c['original_filename']).is_file() or stored_audio(c, archive.name)}
    failure_path = root / 'records-pending-review/openmhz-failures' / f'{day}-law-2.json'
    failures = json.loads(failure_path.read_text()) if failure_path.exists() else {}
    failed = {c['id'] for c in failures.get('calls', [])}
    calls = [c for c in data['calls'] if c['original_filename'] not in saved and c['id'] not in failed]
    if calls:
        manifest = {'date': day, 'timezone': 'America/Denver', 'system': 'dcfems',
                    'talkgroup': 5922, 'coverage': 'unknown', 'count': len(calls),
                    'calls': calls, 'source_inventory': {k: v for k, v in data.items() if k != 'calls'}}
        validate_manifest(manifest)
        pending.parent.mkdir(parents=True, exist_ok=True)
        write_json(pending, manifest)
    return {'date': day, 'queued': len(calls), 'already_saved': len(saved),
            'known_failures_not_retried': len(failed)}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--date', required=True)
    parser.add_argument('--root', type=Path, default=Path.cwd())
    args = parser.parse_args()
    print(json.dumps(prepare(args.root.resolve(), args.date), indent=2))
