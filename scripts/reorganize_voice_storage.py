"""Split legacy voice JSON into reusable embeddings and comparison results.

Migration is copy-only: legacy objects are never deleted or overwritten.
"""
import argparse
import copy
import hashlib
import json
from pathlib import Path
import re
from decimal import Decimal

PREFIX = 'voice-recognition/6001'
LEGACY = re.compile(r'^voice-recognition/6001/(\d{4}-\d{2}-\d{2})/voices.json$')


def encode(data):
    return (json.dumps(data, indent=2, sort_keys=True, allow_nan=False) + '\n').encode()


def split_result(data):
    from radio_config import valid_day
    day = valid_day(data['date'])
    if data.get('talkgroup') != 6001 or data.get('status') not in ('complete', 'partial_error'):
        raise ValueError('Unexpected voice archive identity or status')
    model, revision = data['model'], data['model_revision']
    if (not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', model)
            or any(part in ('.', '..') for part in model.split('/'))):
        raise ValueError('Invalid model identifier')
    if not re.fullmatch(r'[0-9a-f]{40,64}', revision):
        raise ValueError('Exact model revision is required')
    model_folder = model.replace('/', '--') + '--' + revision
    method = data['clustering']
    if method != 'complete-linkage-cosine':
        raise ValueError('Unsupported comparison method')
    threshold = Decimal(str(data['similarity_threshold']))
    if not threshold.is_finite() or not 0 < threshold < 1:
        raise ValueError('Invalid similarity threshold')
    label = format(threshold.normalize(), 'f')
    label += '0' * max(0, 2 - len(label.split('.')[1]))
    root = f'{PREFIX}/{day}'
    embedding_key = f'{root}/embeddings/{model_folder}/embeddings.json'
    comparison_key = f'{root}/comparisons/{model_folder}/{method}/threshold-{label}/groups.json'
    embeddings = {k: copy.deepcopy(v) for k, v in data.items()
                  if k not in ('clips', 'groups', 'similarity_threshold', 'clustering', 'selected_clip_numbers')}
    embeddings['schema_version'] = 2
    embeddings['kind'] = 'speaker_embeddings'
    embeddings['clips'] = [{k: copy.deepcopy(v) for k, v in c.items()
                            if k not in ('voice', 'min_group_similarity')} for c in data['clips']]
    numbers = [c['clip_number'] for c in embeddings['clips']]
    if len(set(numbers)) != len(numbers):
        raise ValueError('Duplicate original clip numbers')
    if data.get('selected_clip_numbers'):
        raise ValueError('Subset experiments cannot be stored as daily embeddings')
    embedded = [c for c in embeddings['clips'] if c['status'] == 'embedded']
    if any(not c.get('embedding') for c in embedded):
        raise ValueError('Missing accepted embedding')
    embedding_bytes = encode(embeddings)
    comparison = {
        'schema_version': 2, 'kind': 'speaker_comparison', 'date': day,
        'talkgroup': 6001, 'model': model, 'model_revision': revision,
        'embeddings_key': embedding_key,
        'embeddings_sha256': hashlib.sha256(embedding_bytes).hexdigest(),
        'source_metadata_sha256': data['source_metadata_sha256'],
        'min_speech_seconds': data['min_speech_seconds'],
        'similarity_threshold': float(threshold), 'clustering': method,
        'human_verified': False, 'status': data['status'],
        'groups': copy.deepcopy(data['groups']),
        'clips': [{k: copy.deepcopy(v) for k, v in c.items() if k != 'embedding'}
                  for c in data['clips']]
    }
    return {embedding_key: embedding_bytes, comparison_key: encode(comparison)}


def read_optional(client, bucket, key):
    try:
        response = client.get_object(Bucket=bucket, Key=key)
    except Exception as exc:
        code = getattr(exc, 'response', {}).get('Error', {}).get('Code')
        if code in ('NoSuchKey', '404', 'NotFound'):
            return None
        raise
    body = response['Body']
    try:
        content = body.read()
    finally:
        body.close()
    expected = response.get('Metadata', {}).get('sha256')
    if expected and hashlib.sha256(content).hexdigest() != expected:
        raise ValueError('Stored checksum mismatch: ' + key)
    return content


def write_layout(client, bucket, objects, *, replace=False):
    from r2_audio import read_verified
    # Check every destination before creating any object for this day.
    existing = {key: read_optional(client, bucket, key) for key in objects}
    if not replace:
        for key, content in objects.items():
            if existing[key] is not None and existing[key] != content:
                raise ValueError('Conflicting destination; preserved without overwrite: ' + key)
    for key, content in objects.items():
        digest = hashlib.sha256(content).hexdigest()
        if existing[key] != content:
            options = {} if replace else {'IfNoneMatch': '*'}
            client.put_object(Bucket=bucket, Key=key, Body=content,
                              ContentType='application/json', Metadata={'sha256': digest}, **options)
        read_verified(client, bucket, key, digest, len(content))


def migrate(client, bucket, *, apply=False):
    report = {'apply': apply, 'legacy_objects': 0, 'days': [], 'errors': []}
    paginator = client.get_paginator('list_objects_v2')
    keys = sorted(obj['Key'] for page in paginator.paginate(Bucket=bucket, Prefix=PREFIX + '/')
                  for obj in page.get('Contents', []) if LEGACY.fullmatch(obj['Key']))
    for key in keys:
        report['legacy_objects'] += 1
        try:
            original = read_optional(client, bucket, key)
            if original is None:
                raise ValueError('Legacy object disappeared')
            data = json.loads(original)
            if data['date'] != LEGACY.fullmatch(key)[1]:
                raise ValueError('Legacy key/date mismatch')
            objects = split_result(data)
            row = {'date': data['date'], 'legacy_key': key,
                   'legacy_sha256': hashlib.sha256(original).hexdigest(),
                   'destinations': list(objects), 'embedded_clips':
                       sum(c['status'] == 'embedded' for c in data['clips'])}
            if apply:
                write_layout(client, bucket, objects)
                # Also verify that the original object was preserved.
                if read_optional(client, bucket, key) != original:
                    raise ValueError('Legacy object changed during migration')
                row['status'] = 'copied_and_verified'
            else:
                for target, content in objects.items():
                    old = read_optional(client, bucket, target)
                    if old is not None and old != content:
                        raise ValueError('Conflicting destination: ' + target)
                row['status'] = 'planned'
            report['days'].append(row)
            print(f"{data['date']}: {row['status']}", flush=True)
        except Exception as exc:
            report['errors'].append({'key': key, 'error': str(exc)})
    return report


def main():
    from r2_audio import client_and_bucket
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true', help='Copy and readback-verify; default is dry run')
    parser.add_argument('--report', default='voice-storage-migration.json')
    args = parser.parse_args()
    client, bucket = client_and_bucket()
    report = migrate(client, bucket, apply=args.apply)
    Path(args.report).write_bytes(encode(report))
    print(json.dumps({'days': len(report['days']), 'errors': len(report['errors']), 'apply': args.apply}))
    if report['errors']:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
