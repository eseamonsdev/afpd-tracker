"""Remove only verified connection probes and redundant records/ test copies."""
import gzip
import hashlib
import json
from pathlib import Path
import re
from r2_audio import client_and_bucket, read_verified

PROBE = b'AFPD GitHub Actions R2 connection verification\n'
PREFIXES = ('_connection-tests/', 'records/')


def listing(client, bucket, prefix):
    objects = {}
    for page in client.get_paginator('list_objects_v2').paginate(Bucket=bucket, Prefix=prefix):
        for obj in page.get('Contents', []):
            objects[obj['Key']] = (obj['Size'], obj['ETag'])
    return objects


def main():
    client, bucket = client_and_bucket()
    report = json.loads(gzip.decompress(Path('findings/r2-radio-audio-migration-2026-10-25.json.gz').read_bytes()))
    if report['summary']['status'] != 'all_verified' or report['summary']['bucket'] != bucket:
        raise ValueError('Migration audit does not match the target bucket')
    audited = {row['key']: row for row in report['files']}
    archive_before = listing(client, bucket, 'openmhz/')
    targets = {key: metadata for prefix in PREFIXES for key, metadata in listing(client, bucket, prefix).items()}
    # Preflight every candidate before performing any deletion.
    for key, (size, etag) in targets.items():
        if key.endswith('/') and size == 0:
            continue
        if key.startswith('_connection-tests/'):
            if not re.fullmatch(r'_connection-tests/github-[0-9a-f]{32}\.txt', key):
                raise ValueError('Unexpected object in connection tests; retaining all candidates: ' + key)
            read_verified(client, bucket, key, hashlib.sha256(PROBE).hexdigest(), len(PROBE))
        elif key.startswith('records/openmhz/'):
            canonical = key.removeprefix('records/')
            row = audited.get(canonical)
            if row is None:
                raise ValueError('Redundant audio lacks migration proof: ' + key)
            read_verified(client, bucket, key, row['sha256'], row['size_bytes'])
            read_verified(client, bucket, canonical, row['sha256'], row['size_bytes'])
        else:
            raise ValueError('Unexpected records object; retaining all candidates: ' + key)
    for key, (size, etag) in targets.items():
        if not key.startswith(PREFIXES) or key.startswith('openmhz/'):
            raise ValueError('Deletion scope guard failed')
        current = client.head_object(Bucket=bucket, Key=key)
        if current['ContentLength'] != size or current['ETag'] != etag:
            raise ValueError('Candidate changed after verification: ' + key)
        client.delete_object(Bucket=bucket, Key=key)
    remaining = {key: metadata for prefix in PREFIXES for key, metadata in listing(client, bucket, prefix).items()}
    archive_after = listing(client, bucket, 'openmhz/')
    if remaining:
        raise ValueError('Test-prefix cleanup is incomplete')
    if archive_after != archive_before:
        raise ValueError('Archive inventory changed during cleanup')
    result = {'bucket': bucket, 'deleted_keys': sorted(targets), 'deleted_objects': len(targets),
              'remaining_test_objects': 0, 'archive_objects_retained': len(archive_after),
              'archive_keys_sizes_and_etags_unchanged': True}
    Path('r2-test-cleanup-result.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result), flush=True)


if __name__ == '__main__':
    main()
