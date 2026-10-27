#!/usr/bin/env python3
"""Prepare a date/talkgroup from preserved metadata; never retry known failures."""
import argparse
import json
from pathlib import Path
import subprocess

from download_openmhz_manifest import validate_manifest, write_json
from radio_config import BRANCHES, TALKGROUPS, archive_path, metadata_paths, valid_day, valid_talkgroup
from r2_audio import stored_audio


def source_metadata(root, day, talkgroup, fetch=False):
    paths = metadata_paths(day, talkgroup)
    for path in paths:
        if (root / path).is_file():
            return json.loads((root / path).read_text())
    if fetch:
        # Copy only this requested metadata file. Never merge branches or audio.
        for branch in BRANCHES:
            subprocess.run(['git', 'fetch', 'origin', branch], cwd=root, check=True)
            for path in paths:
                result = subprocess.run(['git', 'show', f'origin/{branch}:{path.as_posix()}'],
                                        cwd=root, text=True, capture_output=True)
                if result.returncode == 0:
                    data = json.loads(result.stdout)
                    if data.get('date') != day or data.get('talkgroup') != talkgroup:
                        raise ValueError('Source metadata identity mismatch')
                    destination = root / paths[0]
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    write_json(destination, data)
                    return data
    # An already archived day can safely resolve to a no-op without new metadata.
    archived = archive_path(root, day, talkgroup) / 'calls.json'
    if archived.exists():
        return json.loads(archived.read_text())
    raise ValueError(f'No preserved metadata for {day}, talkgroup {talkgroup}; collect it first')


def prepare(root, day, talkgroup=6001, fetch=False):
    day, talkgroup = valid_day(day), valid_talkgroup(talkgroup)
    channel = TALKGROUPS[talkgroup][0]
    pending = root / 'records-pending-review/openmhz-manifests' / f'{day}-{channel}.json'
    legacy = pending.with_name(day + '.json')
    if talkgroup == 6001 and legacy.exists() and not pending.exists():
        pending = legacy
    if pending.exists():
        data = json.loads(pending.read_text())
        validate_manifest(data)
        if data['date'] != day or data['talkgroup'] != talkgroup:
            raise ValueError('Pending manifest belongs to a different date or talkgroup')
        return {'date': day, 'talkgroup': talkgroup, 'resuming': True, 'manifest': pending.name}
    data = source_metadata(root, day, talkgroup, fetch)
    if (data.get('date') != day or data.get('talkgroup') != talkgroup
            or data.get('count') != len(data.get('calls', []))):
        raise ValueError('Preserved metadata identity/count mismatch')
    folder = archive_path(root, day, talkgroup)
    existing_path = folder / 'calls.json'
    existing = json.loads(existing_path.read_text()) if existing_path.exists() else {}
    saved = {c['original_filename'] for c in existing.get('calls', [])
             if (folder / c['original_filename']).is_file() or stored_audio(c, folder.name)}
    failures_path = root / 'records-pending-review/openmhz-failures' / f'{day}-{channel}.json'
    failures = json.loads(failures_path.read_text()) if failures_path.exists() else {}
    failed = {c['id'] for c in failures.get('calls', [])}
    calls = [c for c in data['calls'] if c['original_filename'] not in saved and c['id'] not in failed]
    if calls:
        coverage = data.get('coverage', 'unknown')
        if coverage not in ('complete', 'partial', 'unknown'):
            coverage = 'unknown'
        manifest = {'date': day, 'timezone': 'America/Denver', 'system': 'dcfems',
                    'talkgroup': talkgroup, 'coverage': coverage, 'count': len(calls), 'calls': calls,
                    'source_inventory': {k: v for k, v in data.items() if k != 'calls'}}
        if coverage == 'partial':
            manifest['collected_through_utc'] = data.get('collected_through_utc')
        validate_manifest(manifest)
        pending.parent.mkdir(parents=True, exist_ok=True)
        write_json(pending, manifest)
    return {'date': day, 'talkgroup': talkgroup, 'manifest': pending.name, 'queued': len(calls),
            'already_saved': len(saved), 'known_failures_not_retried': len(failed)}


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--date', required=True)
    p.add_argument('--talkgroup', type=int, default=6001)
    p.add_argument('--root', type=Path, default=Path.cwd())
    p.add_argument('--fetch-metadata', action='store_true')
    a = p.parse_args()
    print(json.dumps(prepare(a.root.resolve(), a.date, a.talkgroup, a.fetch_metadata)))
