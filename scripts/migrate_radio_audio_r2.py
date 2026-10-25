"""Copy every tracked radio recording to R2, then independently audit every byte.

No source file, calls.json, or R2 object is deleted or overwritten.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
import gzip
import hashlib
import json
from pathlib import Path
import subprocess

from r2_audio import client_and_bucket, object_key, read_verified, upload_one


def inventory(root):
    names = subprocess.check_output(['git', 'ls-files', '-z', '--', 'public/records/openmhz'], cwd=root).decode().split('\0')
    manifests = {}
    entries = []
    for name in sorted(names):
        if not name.endswith(('.m4a', '.mp3', '.wav', '.aac', '.ogg', '.flac')):
            continue
        path = root / name
        # Refuse an unexpected layout instead of silently dropping any audio.
        key = object_key(path.parent.name, path.name)
        if path.parent not in manifests:
            data = json.loads((path.parent / 'calls.json').read_text())
            calls = data['calls'] if isinstance(data, dict) else data
            manifests[path.parent] = {c['original_filename']: c for c in calls}
        call = manifests[path.parent].get(path.name, {})
        entries.append({'github_path': name, 'key': key,
                        'expected_sha256': call.get('sha256'),
                        'expected_size_bytes': call.get('size_bytes')})
    if not entries:
        raise ValueError('No tracked audio found')
    if len({e['key'] for e in entries}) != len(entries):
        raise ValueError('Duplicate R2 object key')
    return entries


def local_proof(root, entry):
    content = (root / entry['github_path']).read_bytes()
    digest = hashlib.sha256(content).hexdigest()
    size = len(content)
    if entry.get('expected_sha256') and entry['expected_sha256'] != digest:
        raise ValueError('GitHub audio checksum differs from metadata: ' + entry['github_path'])
    if entry.get('expected_size_bytes') is not None and entry['expected_size_bytes'] != size:
        raise ValueError('GitHub audio size differs from metadata: ' + entry['github_path'])
    return {'github_path': entry['github_path'], 'key': entry['key'], 'sha256': digest, 'size_bytes': size}


def copy_partition(root, output, partition, partitions, workers):
    client, bucket = client_and_bucket()
    entries = inventory(root)
    selected = [e for i, e in enumerate(entries) if i % partitions == partition]
    output.mkdir(parents=True, exist_ok=True)
    progress = output / f'part-{partition}.jsonl'

    def copy(entry):
        proof = local_proof(root, entry)
        path = root / entry['github_path']
        upload_one(client, bucket, path, proof, path.parent.name)
        return proof

    errors = []
    done = 0
    with progress.open('w') as report, ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(copy, entry): entry for entry in selected}
        for future in as_completed(futures):
            entry = futures[future]
            try:
                proof = future.result()
                report.write(json.dumps(proof) + '\n')
                done += 1
            except Exception as error:
                errors.append({'github_path': entry['github_path'], 'error': str(error)})
            if (done + len(errors)) % 250 == 0:
                report.flush()
                print(json.dumps({'partition': partition, 'copied_and_verified': done,
                                  'total': len(selected), 'errors': len(errors)}), flush=True)
    summary = {'partition': partition, 'partitions': partitions, 'bucket': bucket,
               'expected': len(selected), 'copied_and_verified': done, 'errors': errors}
    (output / f'part-{partition}-summary.json').write_text(json.dumps(summary, indent=2) + '\n')
    print(json.dumps(summary), flush=True)
    if errors or done != len(selected):
        raise ValueError('Incomplete migration partition; successful objects and reports retained')


def audit(root, reports, output, workers):
    client, bucket = client_and_bucket()
    expected = inventory(root)
    copied = {}
    for path in sorted(reports.rglob('part-*.jsonl')):
        for line in path.read_text().splitlines():
            row = json.loads(line)
            if row['github_path'] in copied:
                raise ValueError('Duplicate copy report entry: ' + row['github_path'])
            copied[row['github_path']] = row
    if set(copied) != {e['github_path'] for e in expected}:
        raise ValueError('Copy reports do not cover exactly all tracked audio')
    # Independently list all object keys, rather than trusting upload responses.
    keys = set()
    for page in client.get_paginator('list_objects_v2').paginate(Bucket=bucket, Prefix='openmhz/'):
        keys.update(obj['Key'] for obj in page.get('Contents', []))
    missing = [e['key'] for e in expected if e['key'] not in keys]
    if missing:
        raise ValueError('R2 listing is missing ' + str(len(missing)) + ' recordings')

    def verify(entry):
        proof = local_proof(root, entry)
        if copied[entry['github_path']] != proof:
            raise ValueError('Copy report differs from Git source: ' + entry['github_path'])
        # A second GET hashes the actual object bytes after every copy completed.
        read_verified(client, bucket, proof['key'], proof['sha256'], proof['size_bytes'])
        return proof

    verified = []
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(verify, entry) for entry in expected]
        for future in as_completed(futures):
            verified.append(future.result())
            if len(verified) % 1000 == 0:
                print(json.dumps({'independently_verified': len(verified), 'expected': len(expected)}), flush=True)
    verified.sort(key=lambda r: r['github_path'])
    source = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()
    groups = {}
    for row in verified:
        channel = row['key'].split('/')[1].rsplit('-', 3)[0].removeprefix('openmhz-afpd-')
        groups[channel] = groups.get(channel, 0) + 1
    summary = {'status': 'all_verified', 'bucket': bucket, 'prefix': 'openmhz/',
               'source_commit': source, 'verified_at_utc': datetime.now(timezone.utc).isoformat(),
               'audio_files': len(verified), 'total_bytes': sum(r['size_bytes'] for r in verified),
               'by_talkgroup_archive': groups, 'missing': 0, 'checksum_mismatches': 0,
               'github_audio_deleted': False, 'r2_objects_deleted': False,
               'method': 'Git source SHA-256 + size; upload read-back; independent bucket listing and second full read-back'}
    output.mkdir(parents=True, exist_ok=True)
    report = {'summary': summary, 'files': verified}
    payload = (json.dumps(report, indent=2) + '\n').encode()
    (output / 'r2-radio-audio-migration-2026-10-25.json.gz').write_bytes(gzip.compress(payload, mtime=0))
    (output / 'r2-radio-audio-migration-2026-10-25-summary.json').write_text(json.dumps(summary, indent=2) + '\n')
    print(json.dumps(summary), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['copy', 'audit'])
    parser.add_argument('--root', type=Path, default=Path.cwd())
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--reports', type=Path)
    parser.add_argument('--partition', type=int, default=0)
    parser.add_argument('--partitions', type=int, default=4)
    parser.add_argument('--workers', type=int, default=8)
    args = parser.parse_args()
    if not 1 <= args.workers <= 16 or not 0 <= args.partition < args.partitions:
        parser.error('Invalid partition or worker count')
    if args.mode == 'copy':
        copy_partition(args.root, args.output, args.partition, args.partitions, args.workers)
    else:
        if not args.reports:
            parser.error('audit requires --reports')
        audit(args.root, args.reports, args.output, args.workers)
