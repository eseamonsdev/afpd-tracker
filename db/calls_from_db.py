"""Copy authoritative D1 transcript/verification values into tracked calls.json files."""

import argparse
import json
from pathlib import Path
import sqlite3
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
ARCHIVES = ROOT / 'public/records/openmhz'
WRANGLER = ROOT / 'node_modules/.bin/wrangler'


def reconcile(connection, archives=ARCHIVES):
    """Validate all matching IDs before writing any archive."""
    rows = connection.execute('SELECT id, archive_path, transcript, transcript_validated FROM radio_clips').fetchall()
    by_path = {}
    for clip_id, archive_path, transcript, validated in rows:
        by_path.setdefault(archive_path, {})[clip_id] = (transcript, validated == 1)
    if not rows:
        raise ValueError('No radio clips found in the D1 export')
    prepared = []
    for relative, clips in sorted(by_path.items()):
        path = ROOT / relative
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
            if call.get('transcript') != transcript or call.get('validated', False) is not verified:
                if call.get('transcript') != transcript:
                    call['transcript'] = transcript
                if call.get('validated', False) is not verified:
                    call['validated'] = verified
                changes += 1
        if changes:
            indent = 4 if '\n    "' in raw[:200] else 2
            prepared.append((path, json.dumps(data, ensure_ascii=False, indent=indent) + '\n', changes))
    for path, content, _ in prepared:
        path.write_text(content, encoding='utf-8')
    print(f'Updated {sum(item[2] for item in prepared)} clips in {len(prepared)} calls.json files.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database', default='afpd-data', help='Remote D1 name, e.g. afpd-data-staging')
    args = parser.parse_args()
    if not WRANGLER.is_file():
        parser.error('Wrangler is not installed; run npm ci first')
    with tempfile.TemporaryDirectory() as directory:
        dump = Path(directory) / 'radio-export.sql'
        subprocess.run([str(WRANGLER), 'd1', 'export', args.database, '--remote',
                        f'--output={dump}', '--skip-confirmation'], cwd=ROOT, check=True)
        with sqlite3.connect(':memory:') as connection:
            connection.executescript(dump.read_text(encoding='utf-8'))
            reconcile(connection)


if __name__ == '__main__':
    main()
