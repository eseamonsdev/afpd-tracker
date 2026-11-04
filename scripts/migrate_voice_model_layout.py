"""Move verified voice JSON into model/revision-first storage, without re-embedding."""
import argparse
import hashlib
import json
from pathlib import Path
import re

from radio_config import valid_day
from reorganize_voice_storage import encode, read_optional, write_layout

OLD_PREFIX = 'voice-recognition/6001/'
MODEL_FOLDER = r'[A-Za-z0-9_.-]+--[A-Za-z0-9_.-]+--[0-9a-f]{40,64}'
EMBEDDINGS = re.compile(r'^' + OLD_PREFIX + r'(\d{4}-\d{2}-\d{2})/embeddings/(' + MODEL_FOLDER + r')/embeddings.json$')
COMPARISONS = re.compile(r'^' + OLD_PREFIX + r'(\d{4}-\d{2}-\d{2})/comparisons/(' + MODEL_FOLDER + r')/complete-linkage-cosine/(threshold-[0-9.]+)/groups.json$')
LEGACY = re.compile(r'^' + OLD_PREFIX + r'(\d{4}-\d{2}-\d{2})/voices.json$')


def listing(client, bucket, prefix):
    return {obj['Key']: (obj.get('Size'), obj.get('ETag'))
            for page in client.get_paginator('list_objects_v2').paginate(Bucket=bucket, Prefix=prefix)
            for obj in page.get('Contents', [])}


def identity(data, day, folder=None):
    valid_day(day)
    if data.get('date') != day or data.get('talkgroup') != 6001:
        raise ValueError('Source identity mismatch')
    model, revision = data['model'], data['model_revision']
    if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', model) or any(p in ('.', '..') for p in model.split('/')):
        raise ValueError('Invalid model')
    expected = model.replace('/', '--') + '--' + revision
    if not re.fullmatch(MODEL_FOLDER, expected) or (folder and expected != folder):
        raise ValueError('Model/revision mismatch')
    return expected


def relocate(key, content):
    """Embeddings and legacy bundles are copied byte for byte; only pointers change."""
    data = json.loads(content)
    match = EMBEDDINGS.fullmatch(key)
    if match:
        day, folder = match.groups()
        identity(data, day, folder)
        if data.get('kind') != 'speaker_embeddings' or data.get('schema_version') != 2:
            raise ValueError('Unsupported embeddings')
        return f'voice-recognition/{folder}/6001/embeddings/{day}/embeddings.json', content
    match = COMPARISONS.fullmatch(key)
    if match:
        day, folder, threshold = match.groups()
        identity(data, day, folder)
        if data.get('kind') != 'speaker_comparison' or data.get('clustering') != 'complete-linkage-cosine':
            raise ValueError('Unsupported comparison')
        if abs(float(threshold.removeprefix('threshold-')) - float(data['similarity_threshold'])) > 1e-12:
            raise ValueError('Threshold mismatch')
        old_embedding = f'{OLD_PREFIX}{day}/embeddings/{folder}/embeddings.json'
        if data.get('embeddings_key') != old_embedding:
            raise ValueError('Unexpected comparison embedding reference')
        data['embeddings_key'] = f'voice-recognition/{folder}/6001/embeddings/{day}/embeddings.json'
        return f'voice-recognition/{folder}/6001/comparisons/complete-linkage-cosine/{threshold}/{day}/groups.json', encode(data)
    match = LEGACY.fullmatch(key)
    if match:
        day = match[1]
        folder = identity(data, day)
        return f'voice-recognition/{folder}/6001/archives/legacy/{day}/voices.json', content
    raise ValueError('Unknown object in old voice prefix; nothing will be removed: ' + key)


def migrate(client, bucket, *, apply=False, remove_old=False, report_path=None):
    if remove_old and not apply:
        raise ValueError('Cleanup requires --apply')
    before = listing(client, bucket, OLD_PREFIX)
    sources, destinations, rows, roots = {}, {}, [], set()
    # Preflight every object and destination before any mutation.
    for key in sorted(before):
        content = read_optional(client, bucket, key)
        if content is None:
            raise ValueError('Source disappeared: ' + key)
        target, moved = relocate(key, content)
        if target in destinations and destinations[target] != moved:
            raise ValueError('Conflicting migration targets')
        existing = read_optional(client, bucket, target)
        if existing is not None and existing != moved:
            raise ValueError('Destination conflict; all sources retained: ' + target)
        sources[key], destinations[target] = content, moved
        roots.add('/'.join(target.split('/')[:3]))
        data = json.loads(content)
        rows.append({'source': key, 'destination': target,
                     'source_sha256': hashlib.sha256(content).hexdigest(),
                     'destination_sha256': hashlib.sha256(moved).hexdigest(),
                     'date': data['date'], 'kind': data.get('kind', 'legacy_voice_bundle'),
                     'embedded_clips': sum(c.get('status') == 'embedded' for c in data.get('clips', []))})
    # Verify that relocated comparisons still identify the exact embedding snapshot.
    for key, content in destinations.items():
        if '/comparisons/' not in key:
            continue
        data = json.loads(content)
        embedding_key = data['embeddings_key']
        snapshot = destinations.get(embedding_key)
        if snapshot is None:
            snapshot = read_optional(client, bucket, embedding_key)
        if snapshot is None or hashlib.sha256(snapshot).hexdigest() != data['embeddings_sha256']:
            raise ValueError('Comparison embedding snapshot mismatch; all sources retained: ' + key)
    # R2 has no empty directories. Mark the two reserved profile-matching prefixes.
    for root in roots:
        for mode in ('test-runs', 'day-runs'):
            marker = f'{root}/comparisons/profile-matching/{mode}/.keep'
            existing = read_optional(client, bucket, marker)
            if existing not in (None, b''):
                raise ValueError('Unexpected folder marker content')
            destinations[marker] = b''
    report = {'apply': apply, 'remove_old': remove_old, 'source_objects': len(sources),
              'destination_objects': len(destinations), 'days': len({r['date'] for r in rows}),
              'model_talkgroup_roots': sorted(roots), 'objects': rows, 'status': 'planned'}
    def save():
        if report_path:
            Path(report_path).write_bytes(encode(report))
    save()
    if not apply:
        return report
    write_layout(client, bucket, destinations)
    if listing(client, bucket, OLD_PREFIX) != before:
        raise ValueError('Source inventory changed; retaining all sources')
    for key, original in sources.items():
        if read_optional(client, bucket, key) != original:
            raise ValueError('Source changed; retaining all sources')
    report['status'] = 'all_copied_and_verified'
    save()
    if remove_old:
        # Every object has a verified replacement, including historical legacy bundles.
        for row in rows:
            key, target = row['source'], row['destination']
            if not key.startswith(OLD_PREFIX) or target.startswith(OLD_PREFIX):
                raise ValueError('Deletion scope guard failed')
            if read_optional(client, bucket, target) != destinations[target]:
                raise ValueError('Destination changed during cleanup')
            if read_optional(client, bucket, key) != sources[key]:
                raise ValueError('Source changed during cleanup')
            client.delete_object(Bucket=bucket, Key=key)
        if listing(client, bucket, OLD_PREFIX):
            raise ValueError('Old prefix cleanup incomplete')
        report['status'] = 'moved_and_verified'
        report['old_objects_remaining'] = 0
        save()
    print(json.dumps({k: v for k, v in report.items() if k != 'objects'}), flush=True)
    return report


def main():
    from r2_audio import client_and_bucket
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--remove-old', action='store_true')
    parser.add_argument('--report', default='voice-model-layout-migration.json')
    args = parser.parse_args()
    client, bucket = client_and_bucket()
    migrate(client, bucket, apply=args.apply, remove_old=args.remove_old, report_path=args.report)


if __name__ == '__main__':
    main()
