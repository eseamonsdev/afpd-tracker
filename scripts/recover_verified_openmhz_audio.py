#!/usr/bin/env python3
"""Recover explicitly browser-verified source-duration discrepancies, preserving both measurements."""
import hashlib
import json
import math
import shutil
import subprocess
import tempfile
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from download_openmhz_manifest import Downloader, import_manifest, validate_manifest, write_json

from radio_config import DEFAULT_PAUSE_MS, valid_day, valid_talkgroup, valid_pause_ms


def recover(root, day, talkgroup, proof_path, *, pause_ms=DEFAULT_PAUSE_MS):
    pause_ms = valid_pause_ms(pause_ms)
    valid_day(day)
    valid_talkgroup(talkgroup)
    ROOT = root.resolve()
    proof = json.loads((ROOT / proof_path).read_text())
    approved = {c['id']: c['media_url'] for c in proof['calls']}
    expected_hashes = {c['id']: c.get('sha256') for c in proof['calls']}
    network = Downloader(pause_ms=pause_ms)
    totals = []
    with tempfile.TemporaryDirectory(prefix='verified-openmhz-recovery-') as directory:
        cache = Path(directory)
        class CachedDownloader:
            def download(self, url, destination):
                shutil.copyfile(cache / url.rsplit('/', 1)[-1], destination)
        for failure in sorted((ROOT / 'records-pending-review/openmhz-failures').glob('*.json')):
            data = json.loads(failure.read_text())
            if data.get('date') != day or data.get('talkgroup') != talkgroup:
                continue
            validate_manifest(data)
            data['calls'] = [c for c in data['calls'] if approved.get(c['id']) == c['media_url']]
            if not data['calls']:
                continue
            data.update(count=len(data['calls']), coverage='unknown', collected_through_utc=None)
            for call in data['calls']:
                if approved.get(call['id']) != call['media_url']:
                    raise ValueError('Failure lacks browser-verified identity: ' + call['id'])
                path = cache / call['original_filename']
                if not path.exists():
                    network.download(call['media_url'], path)
                    content = path.read_bytes()
                    if len(content) < 12 or content[4:8] != b'ftyp':
                        raise ValueError('Invalid M4A')
                    subprocess.run(['ffmpeg', '-v', 'error', '-i', str(path), '-f', 'null', '-'],
                                   check=True, capture_output=True, timeout=60)
                expected_hash = expected_hashes.get(call['id'])
                if expected_hash and hashlib.sha256(path.read_bytes()).hexdigest() != expected_hash:
                    raise ValueError('Audio differs from manually downloaded proof: ' + call['id'])
                result = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration',
                                         '-of', 'default=noprint_wrappers=1:nokey=1', str(path)],
                                        check=True, capture_output=True, text=True, timeout=30)
                duration = float(result.stdout.strip())
                if not math.isfinite(duration) or duration <= 0:
                    raise ValueError('Invalid measured duration')
                call.pop('download_error', None)
                call.update(audio_downloaded=True, sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
                            audio_duration_seconds=duration,
                            media_url_status='browser_identity_verified',
                            source_audio_verification={
                                'method': 'OpenMHz interactive call detail; autoplay disabled',
                                'verified_date': proof['verified_date'],
                                'call_link': 'https://openmhz.com/system/dcfems?filter-type=talkgroup&filter-code='
                                             + str(call['talkgroup']) + '&call-id=' + call['id']
                                             + '&time=' + str(call['epoch'] * 1000 + 1),
                                'media_url': call['media_url'],
                                'note': 'Source call ID and download URL verified together. Original displayed duration retained; actual audio decoded and measured independently.'
                            })
            source = cache / failure.name
            write_json(source, data)
            summary = import_manifest(ROOT, source, CachedDownloader(), pause_ms=pause_ms)
            if summary['failed']:
                raise ValueError('Recovery still has failed entries')
            totals.append(summary)
            print(json.dumps(summary), flush=True)
    subprocess.run(['node', '--input-type=module', '-e',
                    "import { buildRadioIndex } from './lib/build-radio-index.js'; buildRadioIndex();"],
                   check=True, cwd=ROOT)
    print(json.dumps({'recovered_unique_files': sum(s['downloaded'] for s in totals), 'days': totals}), flush=True)

    return totals


if __name__ == '__main__':
    import argparse
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--date', required=True)
    p.add_argument('--talkgroup', type=int, default=6001)
    p.add_argument('--proof', type=Path, required=True)
    p.add_argument('--root', type=Path, default=Path.cwd())
    p.add_argument('--pause-ms', type=valid_pause_ms, default=DEFAULT_PAUSE_MS)
    a = p.parse_args()
    recover(a.root, a.date, a.talkgroup, a.proof, pause_ms=a.pause_ms)
