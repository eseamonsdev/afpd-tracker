#!/usr/bin/env python3
"""Publish audio already decoded and measured manually, requiring exact proof hashes."""
import hashlib
import json
import math
import tempfile
from pathlib import Path
from download_openmhz_manifest import Downloader, validate_manifest, normalize_call_metadata, write_json, archive_readme, coverage_metadata
from r2_audio import client_and_bucket, upload_one, stored_audio

def merge_recovered(data, recovered):
    original = {c['original_filename']: c for c in data['calls']}
    merged = dict(original)
    duplicates = list(data.get('duplicate_source_calls', []))
    seen = {c['id'] for c in data['calls'] + duplicates}
    for call in recovered:
        if call['id'] in seen:
            raise ValueError('Recovery ID already archived: ' + call['id'])
        name = call['original_filename']
        if name in merged:
            if merged[name]['sha256'] != call['sha256']:
                raise ValueError('Duplicate filename has different audio')
            duplicates.append(call)
        else:
            merged[name] = call
        seen.add(call['id'])
    result = dict(data)
    result.update(calls=sorted(merged.values(), key=lambda c: (c['epoch'], c['id'])),
                  count=len(merged), duplicate_source_calls=duplicates,
                  source_call_count=len(merged) + len(duplicates), download_failure_count=0)
    result.pop('coverage_note', None)
    assert all(next(c for c in result['calls'] if c['id'] == old['id']) == old for old in original.values())
    return result

def main():
    root = Path.cwd()
    proof = json.loads((root / 'records-pending-review/openmhz-queues/verified-duration-recovery.json').read_text())
    if proof.get('manual_decode_method') != 'ffmpeg full decode; ffprobe duration':
        raise ValueError('Explicit manual decode evidence required')
    approved = {c['id']: c for c in proof['calls']}
    if len(approved) != len(proof['calls']):
        raise ValueError('Duplicate proof IDs')
    network = Downloader()
    client, bucket = client_and_bucket()
    for day in proof['dates']:
        failure = root / 'records-pending-review/openmhz-failures' / (day + '-law-2.json')
        data = json.loads(failure.read_text())
        validate_manifest(data)
        if not {c['id'] for c in data['calls']} <= set(approved):
            raise ValueError('Unverified failure')
        folder = root / 'public/records/openmhz' / ('openmhz-afpd-law-2-' + day)
        existing = json.loads((folder / 'calls.json').read_text())
        recovered = []
        with tempfile.TemporaryDirectory(prefix='manual-audio-recovery-') as temp:
            for incoming in data['calls']:
                evidence = approved[incoming['id']]
                duration = evidence['audio_duration_seconds']
                if evidence['media_url'] != incoming['media_url'] or not isinstance(duration, (int, float)) or not math.isfinite(duration) or duration <= 0:
                    raise ValueError('Invalid manual proof')
                path = Path(temp) / incoming['original_filename']
                if not path.exists():
                    network.download(incoming['media_url'], path)
                content = path.read_bytes()
                if (len(content) != evidence['size_bytes'] or content[4:8] != b'ftyp'
                        or hashlib.sha256(content).hexdigest() != evidence['sha256']):
                    raise ValueError('Downloaded bytes differ from manual proof')
                call = normalize_call_metadata(incoming, day)
                call.pop('download_error', None)
                call.update(sha256=evidence['sha256'], size_bytes=len(content),
                            audio_duration_seconds=duration,
                            source_duration_matches=abs(duration - call['displayed_seconds']) <= 1,
                            source_audio_verification={'method': proof['manual_decode_method'],
                              'verified_date': proof['verified_date'], 'call_link': call['call_link'],
                              'media_url': call['media_url'], 'sha256': evidence['sha256'],
                              'note': 'Interactive source ID and Download link verified together. Exact downloaded bytes were fully decoded and measured locally; source duration retained.'})
                call['audio_storage'] = upload_one(client, bucket, path, call, folder.name)
                if not stored_audio(call, folder.name):
                    raise ValueError('R2 verification incomplete')
                recovered.append(call)
        result = merge_recovered(existing, recovered)
        source = json.loads((root / 'records-pending-review/openmhz-metadata/law-2' / day / 'calls.json').read_text())
        all_calls = result['calls'] + result.get('duplicate_source_calls', [])
        if {c['id'] for c in source['calls']} == {c['id'] for c in all_calls} and source.get('coverage') == 'complete':
            _, cutoff = coverage_metadata(source, day)
            result.update(coverage='complete', collected_through_utc=cutoff.isoformat().replace('+00:00', 'Z'))
        validate_manifest(result)
        report = json.loads((folder / 'validation.json').read_text())
        report.update(count=result['count'], source_call_count=result['source_call_count'],
                      coverage=result['coverage'], collected_through_utc=result.get('collected_through_utc'),
                      validated=True, download_failure_count=0,
                      source_duration_discrepancies=sorted({c['original_filename'] for c in all_calls if not c.get('source_duration_matches', True)}))
        report.pop('coverage_note', None)
        report.setdefault('manual_recoveries', []).append({'verified_date': proof['verified_date'], 'source_ids': [c['id'] for c in recovered], 'unique_files': len({c['original_filename'] for c in recovered})})
        write_json(folder / 'calls.json', result)
        write_json(folder / 'validation.json', report)
        (folder / 'README.txt').write_text(archive_readme(result))
        failure.unlink()
        print(json.dumps({'date': day, 'recovered_source_entries': len(recovered), 'recovered_unique_files': len({c['original_filename'] for c in recovered}), 'total_unique_files': result['count'], 'total_source_entries': result['source_call_count'], 'remaining_failures': 0}), flush=True)

if __name__ == '__main__':
    main()
