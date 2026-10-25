"""Remove only audited radio audio from Git after a fresh full R2 read-back.

No R2 object is changed. Transcripts and other metadata fields are preserved.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
import gzip
import hashlib
import json
from pathlib import Path, PurePosixPath
import subprocess

from r2_audio import client_and_bucket, object_key, read_verified

AUDIT = 'findings/r2-radio-audio-migration-2026-10-25.json.gz'
SUMMARY = 'findings/r2-radio-audio-removal-2026-10-25.json'
PREFIX = 'public/records/openmhz/'


def validate_proof(row):
    path = PurePosixPath(row['github_path'])
    if path.as_posix() != row['github_path'] or len(path.parts) != 5 or path.parts[:3] != ('public', 'records', 'openmhz'):
        raise ValueError('Removal target is outside the radio archive')
    key = object_key(path.parts[3], path.name)
    if row['key'] != key or len(row['sha256']) != 64 or any(c not in '0123456789abcdef' for c in row['sha256']):
        raise ValueError('Invalid audit key or checksum')
    if not isinstance(row['size_bytes'], int) or row['size_bytes'] <= 0:
        raise ValueError('Invalid audit audio size')
    return path


def annotate(data, folder, proofs, bucket):
    result = json.loads(json.dumps(data))
    calls = result['calls'] if isinstance(result, dict) else result
    groups = [calls]
    if isinstance(result, dict):
        groups.append(result.get('duplicate_source_calls', []))
    for group in groups:
        for call in group:
            row = proofs.get(PREFIX + folder + '/' + call['original_filename'])
            if row is None:
                continue
            if call.get('sha256') and call['sha256'] != row['sha256']:
                raise ValueError('Manifest checksum differs from audited audio')
            if call.get('size_bytes') is not None and call['size_bytes'] != row['size_bytes']:
                raise ValueError('Manifest size differs from audited audio')
            call['sha256'] = row['sha256']
            call['size_bytes'] = row['size_bytes']
            call['audio_storage'] = {'provider': 'r2', 'bucket': bucket, 'key': row['key'],
                                     'sha256': row['sha256'], 'size_bytes': row['size_bytes'], 'verified': True}
    return result


def remove(root, workers=32):
    client, bucket = client_and_bucket()
    report = json.loads(gzip.decompress((root / AUDIT).read_bytes()))
    summary = report['summary']
    if summary.get('status') != 'all_verified' or summary.get('missing') != 0 or summary.get('checksum_mismatches') != 0 or summary.get('bucket') != bucket:
        raise ValueError('Migration audit is not a complete verification of this bucket')
    rows = report['files']
    proofs = {}
    for row in rows:
        validate_proof(row)
        if row['github_path'] in proofs:
            raise ValueError('Duplicate audit target')
        proofs[row['github_path']] = row
    if len(proofs) != summary['audio_files']:
        raise ValueError('Audit file count mismatch')
    subprocess.run(['git', 'merge-base', '--is-ancestor', summary['source_commit'], 'HEAD'], cwd=root, check=True)
    tracked = set(subprocess.check_output(['git', 'ls-files', '-z', '--', PREFIX], cwd=root).decode().split('\0'))
    targets = [row for name, row in proofs.items() if name in tracked]
    if not targets:
        print(json.dumps({'removed': 0, 'note': 'Audited audio is already absent from this branch'}), flush=True)
        return

    def verify(row):
        content = (root / row['github_path']).read_bytes()
        if len(content) != row['size_bytes'] or hashlib.sha256(content).hexdigest() != row['sha256']:
            raise ValueError('Git audio changed since migration: ' + row['github_path'])
        read_verified(client, bucket, row['key'], row['sha256'], row['size_bytes'])

    # Verify the entire removal set before changing any local file or manifest.
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(verify, row) for row in targets]
        for count, future in enumerate(as_completed(futures), 1):
            future.result()
            if count % 1000 == 0:
                print(json.dumps({'fresh_r2_checksum_checks': count, 'targets': len(targets)}), flush=True)
    manifests = {}
    for row in targets:
        folder = (root / row['github_path']).parent
        manifest = folder / 'calls.json'
        if manifest not in manifests:
            original = json.loads(manifest.read_text())
            manifests[manifest] = annotate(original, folder.name, proofs, bucket)
    for path, data in manifests.items():
        path.write_text(json.dumps(data, indent=2) + '\n')
    # An exact NUL-delimited allowlist is the only input to git rm.
    allowlist = b''.join((row['github_path'] + '\0').encode() for row in targets)
    subprocess.run(['git', 'rm', '--quiet', '--pathspec-from-file=-', '--pathspec-file-nul'],
                   input=allowlist, cwd=root, check=True)
    deleted = set(subprocess.check_output(['git', 'diff', '--cached', '--name-only', '--diff-filter=D', '-z'], cwd=root).decode().split('\0')) - {''}
    if deleted != {row['github_path'] for row in targets}:
        raise ValueError('Staged deletions differ from the audited allowlist')
    result = {'status': 'verified_audio_removed_from_staging', 'bucket': bucket,
              'audio_files_removed': len(targets), 'fresh_checksum_mismatches': 0,
              'metadata_manifests_updated': len(manifests), 'deleted_outside_openmhz': 0,
              'non_audio_files_deleted': 0, 'r2_objects_deleted': 0,
              'verified_at_utc': datetime.now(timezone.utc).isoformat(),
              'migration_audit': AUDIT,
              'retained': 'Transcripts, metadata, validation, audit evidence and all files outside public/records/openmhz',
              'git_history_rewritten': False}
    (root / SUMMARY).write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path.cwd())
    parser.add_argument('--workers', type=int, default=32)
    args = parser.parse_args()
    if not 1 <= args.workers <= 32:
        parser.error('workers must be between 1 and 32')
    remove(args.root, args.workers)
