"""Verified R2 storage for radio audio; metadata stays in Git. Never deletes objects."""
import argparse
import hashlib
import json
import os
import re
import subprocess
from pathlib import Path


def object_key(folder, filename):
    if not re.fullmatch(r'openmhz-afpd-(?:car-to-car|law-2|6036)-\d{4}-\d{2}-\d{2}', folder):
        raise ValueError('Invalid radio archive folder')
    if not re.fullmatch(r'dcfems-\d+-\d+\.m4a', filename):
        raise ValueError('Invalid audio filename')
    return f'openmhz/{folder}/{filename}'


def stored_audio(call, folder):
    storage = call.get('audio_storage', {})
    return (storage.get('provider') == 'r2' and storage.get('verified') is True
            and storage.get('key') in (object_key(folder, call['original_filename']), 'records/' + object_key(folder, call['original_filename']))
            and bool(storage.get('bucket'))
            and bool(re.fullmatch(r'[0-9a-f]{64}', call.get('sha256', '')))
            and storage.get('sha256') == call['sha256']
            and isinstance(call.get('size_bytes'), int) and call['size_bytes'] > 0
            and storage.get('size_bytes') == call['size_bytes'])


def audio_checks(call):
    return {k: call[k] for k in ('sha256', 'size_bytes', 'audio_duration_seconds', 'source_duration_matches') if k in call}


def client_and_bucket():
    from urllib.parse import urlparse
    required = ('R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME', 'R2_ENDPOINT')
    missing = [key for key in required if not os.environ.get(key)]
    if missing:
        raise ValueError('Missing GitHub Actions settings: ' + ', '.join(missing))
    endpoint = urlparse(os.environ['R2_ENDPOINT'])
    if endpoint.scheme != 'https' or not (endpoint.hostname or '').endswith('.r2.cloudflarestorage.com') or endpoint.path not in ('', '/'):
        raise ValueError('Invalid R2 S3 endpoint')
    import boto3
    from botocore.config import Config
    return boto3.client('s3', endpoint_url=os.environ['R2_ENDPOINT'], region_name='auto',
                        aws_access_key_id=os.environ['R2_ACCESS_KEY_ID'],
                        aws_secret_access_key=os.environ['R2_SECRET_ACCESS_KEY'],
                        config=Config(retries={'max_attempts': 3}, connect_timeout=15, read_timeout=60, max_pool_connections=32)), os.environ['R2_BUCKET_NAME']


def read_verified(client, bucket, key, digest, size):
    response = client.get_object(Bucket=bucket, Key=key)
    body = response['Body']
    try:
        content = body.read(size + 1)
    finally:
        body.close()
    if len(content) != size or hashlib.sha256(content).hexdigest() != digest:
        raise ValueError('R2 checksum/size mismatch: ' + key)
    return content


def upload_one(client, bucket, path, call, folder):
    key = object_key(folder, path.name)
    content = path.read_bytes()
    digest = hashlib.sha256(content).hexdigest()
    if digest != call.get('sha256') or len(content) != call.get('size_bytes'):
        raise ValueError('Local audio does not match validated metadata: ' + key)
    # A different object at the same key is an error, never an overwrite.
    try:
        read_verified(client, bucket, key, digest, len(content))
    except Exception as error:
        code = getattr(error, 'response', {}).get('Error', {}).get('Code')
        if code not in ('NoSuchKey', '404', 'NotFound'):
            raise
        client.put_object(Bucket=bucket, Key=key, Body=content, ContentType='audio/mp4',
                          Metadata={'sha256': digest}, IfNoneMatch='*')
        read_verified(client, bucket, key, digest, len(content))
    return {'provider': 'r2', 'bucket': bucket, 'key': key, 'sha256': digest,
            'size_bytes': len(content), 'verified': True}


def upload_new(root, client, bucket):
    # Include ignored new recordings; tracked historical audio stays untouched.
    names = subprocess.check_output(['git', 'ls-files', '-z', '--others', '--',
                                      'public/records/openmhz'], cwd=root).decode().split('\0')
    folders = {}
    for name in names:
        path = root / name
        if path.suffix == '.m4a' and path.is_file():
            folders.setdefault(path.parent, []).append(path)
    uploaded = 0
    for folder, paths in sorted(folders.items()):
        metadata = folder / 'calls.json'
        data = json.loads(metadata.read_text())
        calls = {c['original_filename']: c for c in data['calls']}
        for path in sorted(paths):
            call = calls[path.name]
            # A hydrated or retained local copy is not a new upload. Trust the
            # existing verified R2 record; explicit integrity audits are separate.
            if stored_audio(call, folder.name):
                if call['audio_storage']['bucket'] != bucket:
                    raise ValueError('R2 bucket differs from archive metadata')
                if (path.stat().st_size != call['size_bytes'] or
                        hashlib.sha256(path.read_bytes()).hexdigest() != call['sha256']):
                    raise ValueError('Local audio does not match validated metadata: ' + path.name)
                continue
            call['audio_storage'] = upload_one(client, bucket, path, call, folder.name)
            uploaded += 1
        for duplicate in data.get('duplicate_source_calls', []):
            primary = calls[duplicate['original_filename']]
            if 'audio_storage' in primary:
                duplicate['audio_storage'] = primary['audio_storage']
        temp = metadata.with_suffix('.json.tmp')
        temp.write_text(json.dumps(data, indent=2) + '\n')
        temp.replace(metadata)
    return uploaded


def hydrate(folder, client=None, bucket=None, *, allow_metadata_only=False):
    data = json.loads((folder / 'calls.json').read_text())
    count = 0
    for call in data['calls']:
        path = folder / call['original_filename']
        if path.exists():
            continue
        if not stored_audio(call, folder.name):
            if allow_metadata_only and not call.get('sha256') and not call.get('audio_storage'):
                continue
            raise ValueError('Missing audio without verified R2 metadata: ' + str(path))
        if client is None:
            client, bucket = client_and_bucket()
        if call['audio_storage']['bucket'] != bucket:
            raise ValueError('R2 bucket differs from archive metadata')
        content = read_verified(client, bucket, call['audio_storage']['key'], call['sha256'], call['size_bytes'])
        path.write_bytes(content)
        count += 1
    return count


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path.cwd())
    parser.add_argument('--hydrate', type=Path)
    args = parser.parse_args()
    if args.hydrate:
        print(json.dumps({'hydrated': hydrate(args.hydrate)}))
    else:
        client, bucket = client_and_bucket()
        print(json.dumps({'uploaded_and_read_back_verified': upload_new(args.root, client, bucket), 'bucket': bucket}))
