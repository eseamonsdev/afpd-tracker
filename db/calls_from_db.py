"""Copy staging D1 transcript/verification values into tracked calls.json files."""

import argparse
import json
from pathlib import Path
import sqlite3
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
ARCHIVES = ROOT / 'public/records/openmhz'
WRANGLER = ROOT / 'node_modules/.bin/wrangler'
DATABASE = 'afpd-data-staging'


def reconcile(connection, archives=ARCHIVES, root=ROOT, write=True):
    """Validate all matching IDs before writing any archive."""
    rows = connection.execute('SELECT id, archive_path, transcript, transcript_validated FROM radio_clips').fetchall()
    by_path = {}
    for clip_id, archive_path, transcript, validated in rows:
        by_path.setdefault(archive_path, {})[clip_id] = (transcript, validated == 1)
    if not rows:
        raise ValueError('No radio clips found in the D1 export')
    prepared = []
    preserved = 0
    for relative, clips in sorted(by_path.items()):
        path = root / relative
        if not path.is_relative_to(archives) or path.name != 'calls.json' or not path.is_file():
            raise ValueError(f'Missing or invalid archive path in D1: {relative}')
        raw = path.read_text(encoding='utf-8')
        data = json.loads(raw)
        local_ids = [call['id'] for call in data['calls']]
        if len(local_ids) != len(set(local_ids)) or set(local_ids) != set(clips):
            raise ValueError(f'D1 and JSON clip IDs differ in {relative}; no files were written')
        changes = 0
        for call in data['calls']:
            transcript, verified = clips[call['id']]
            # A newly transcribed JSON clip may precede its first DB import.
            # Empty database fields must never erase that completed text.
            if not (isinstance(transcript, str) and transcript.strip()) and isinstance(call.get('transcript'), str) and call['transcript'].strip():
                preserved += 1
                continue
            if call.get('transcript') != transcript or call.get('validated', False) is not verified:
                if call.get('transcript') != transcript:
                    call['transcript'] = transcript
                if call.get('validated', False) is not verified:
                    call['validated'] = verified
                changes += 1
        if changes:
            indent = 4 if '\n    "' in raw[:200] else 2
            prepared.append((path, json.dumps(data, ensure_ascii=False, indent=indent) + '\n', changes))
    if write:
        for path, content, _ in prepared:
            path.write_text(content, encoding='utf-8')
        print(f'Updated {sum(item[2] for item in prepared)} clips in {len(prepared)} calls.json files.')
        if preserved:
            print(f'Preserved {preserved} completed JSON transcripts because their database values are blank. Run make db-sync to import those first-time transcripts.')
    return prepared


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.parse_args()
    if not WRANGLER.is_file():
        parser.error('Wrangler is not installed; run npm ci first')
    with tempfile.TemporaryDirectory() as directory:
        dump = Path(directory) / 'radio-export.sql'
        subprocess.run([str(WRANGLER), 'd1', 'export', DATABASE, '--remote',
                        f'--output={dump}', '--skip-confirmation'], cwd=ROOT, check=True)
        with sqlite3.connect(':memory:') as connection:
            connection.executescript(dump.read_text(encoding='utf-8'))
            reconcile(connection)


if __name__ == '__main__':
    main()
