#!/usr/bin/env python3
"""Decode archived radio audio once; persist model-scoped phonetic sequences."""
import argparse
from argparse import Namespace
from collections import Counter
from datetime import datetime, timezone
import hashlib
import importlib.metadata
import io
import json
import math
import os
from pathlib import Path
import re
import subprocess
import sys
import tarfile
import tempfile
from urllib.request import urlopen

from radio_config import TALKGROUPS, archive_path, valid_day, valid_talkgroup

ROOT = Path(__file__).resolve().parents[1]
REQUEST = 'records-pending-review/radio-phoneme-request.json'
MODEL = 'uni2005'
MODEL_SHA256 = '92d783125d0eb8173066058bc61ff805389430cf811b149250a4a62b6efc9a2b'
BUNDLE_SHA256 = '7dc4f20802012f64ac07deb04ade263f199c839521e58eae83c99d79028fc4de'
MODEL_URL = 'https://github.com/xinjli/allosaurus/releases/download/v1.0/uni2005.tar.gz'
SETTINGS = {'decoder': 'ffmpeg', 'sample_rate': 16000, 'channels': 1,
            'format': 'pcm_s16le', 'filtering': None, 'vad': None,
            'inventories': ['eng', 'ipa'], 'topk': 1, 'emit': 1.0,
            'approximate_inventory': False, 'timestamps': True,
            'timestamp_semantics': 'CTC emission frame start and analysis window; not phone duration'}


def encoded(value):
    return (json.dumps(value, sort_keys=True, ensure_ascii=False,
                       separators=(',', ':'), allow_nan=False) + '\n').encode()


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def inventory(root):
    jobs = []
    for path in sorted((Path(root) / 'public/records/openmhz').glob('*/calls.json')):
        data = json.loads(path.read_bytes())
        tg, day = valid_talkgroup(data['talkgroup']), valid_day(data['date'])
        if path.parent != archive_path(root, day, tg):
            raise ValueError('Archive identity mismatch: ' + str(path))
        calls = data['calls']
        if not isinstance(calls, list):
            raise ValueError('Invalid archive calls')
        jobs.append({'day': day, 'talkgroup': tg, 'clips': len(calls)})
    if not jobs:
        raise ValueError('No radio archives found')
    identities = [(j['talkgroup'], j['day']) for j in jobs]
    if len(set(identities)) != len(identities):
        raise ValueError('Duplicate archive identity')
    return sorted(jobs, key=lambda j: (j['talkgroup'], j['day']))


def plan(root, days='all', talkgroups='all', batch_index=0, batch_size=256):
    if not 1 <= batch_size <= 256 or batch_index < 0:
        raise ValueError('Invalid matrix batch; size must be 1..256')
    selected_days = None if days == 'all' else {valid_day(d.strip()) for d in days.split(',')}
    selected_tgs = set(TALKGROUPS) if talkgroups == 'all' else {valid_talkgroup(t.strip()) for t in talkgroups.split(',')}
    jobs = [j for j in inventory(root) if j['talkgroup'] in selected_tgs
            and (selected_days is None or j['day'] in selected_days)]
    if selected_days and selected_days - {j['day'] for j in jobs}:
        raise ValueError('Requested dates have no matching archives')
    if not jobs:
        raise ValueError('Selection has no archives')
    start = batch_index * batch_size
    if start >= len(jobs):
        raise ValueError('Batch index is outside selected archives')
    return {'selected_archives': len(jobs), 'selected_clips': sum(j['clips'] for j in jobs),
            'batch_index': batch_index, 'batch_count': math.ceil(len(jobs) / batch_size),
            'include': jobs[start:start + batch_size]}


def model_digest(directory):
    files = {p.relative_to(directory).as_posix(): sha256(p.read_bytes())
             for p in sorted(directory.rglob('*')) if p.is_file()}
    # Deliberately matches the fingerprint measured in the initial experiment.
    return sha256(json.dumps(files, sort_keys=True, separators=(',', ':')).encode())


def ensure_model(directory):
    model_path = directory / MODEL
    if not model_path.exists():
        directory.mkdir(parents=True, exist_ok=True)
        with urlopen(MODEL_URL, timeout=120) as response:
            bundle = response.read()
        if sha256(bundle) != BUNDLE_SHA256:
            raise ValueError('Allosaurus model download checksum mismatch')
        with tarfile.open(fileobj=io.BytesIO(bundle)) as archive:
            # The verified release must contain only uni2005/, with no links.
            for item in archive.getmembers():
                parts = Path(item.name).parts
                if not parts or parts[0] != MODEL or '..' in parts or item.issym() or item.islnk():
                    raise ValueError('Unsafe model archive member')
            archive.extractall(directory, filter='data')
    if model_digest(model_path) != MODEL_SHA256:
        raise ValueError('Allosaurus model files differ from pinned experiment')
    return model_path


def recognizer(model_path):
    import torch
    from allosaurus.app import Recognizer
    from allosaurus.pm.factory import read_pm
    from allosaurus.am.factory import read_am
    from allosaurus.lm.factory import read_lm
    torch.set_num_threads(2)
    config = Namespace(model=MODEL, device_id=-1, lang='ipa', approximate=False, prior=None)
    # Explicit components avoid read_recognizer's implicit 'latest' download.
    return Recognizer(read_pm(model_path, config), read_am(model_path, config),
                      read_lm(model_path, config), config)


def runtime_versions():
    packages = ('allosaurus', 'torch', 'numpy', 'scipy', 'resampy', 'numba', 'panphon')
    result = {p: importlib.metadata.version(p) for p in packages}
    if result['allosaurus'] != '1.0.2':
        raise ValueError('Expected Allosaurus 1.0.2')
    result['python'] = sys.version.split()[0]
    result['ffmpeg'] = subprocess.check_output(['ffmpeg', '-version'], text=True).splitlines()[0]
    return result


def timed_phones(text):
    frames = []
    previous = -1
    for line in text.splitlines():
        start, window, phone = line.split(maxsplit=2)
        start, window = float(start), float(window)
        if not math.isfinite(start) or not math.isfinite(window) or start < 0 or start < previous or window <= 0:
            raise ValueError('Invalid phonetic timestamp')
        if not phone or len(phone.split()) != 1:
            raise ValueError('Invalid phone token')
        frames.append({'start_seconds': start, 'window_seconds': window, 'phone': phone})
        previous = start
    return {'sequence': ' '.join(f['phone'] for f in frames), 'frames': frames}


def prefix(talkgroup, day, configuration):
    valid_talkgroup(talkgroup)
    valid_day(day)
    settings_hash = sha256(encoded(configuration))
    return (f'voice-recognition/allosaurus--{MODEL}--{MODEL_SHA256}/{talkgroup}/'
            f'phonemes/{day}/settings-{settings_hash}')


def read_optional(client, bucket, key):
    try:
        response = client.get_object(Bucket=bucket, Key=key)
    except Exception as error:
        if getattr(error, 'response', {}).get('Error', {}).get('Code') in ('NoSuchKey', '404', 'NotFound'):
            return None
        raise
    try:
        return response['Body'].read()
    finally:
        response['Body'].close()


def publish(client, bucket, key, content, immutable=False):
    from r2_audio import read_verified
    extra = {'IfNoneMatch': '*'} if immutable else {}
    try:
        client.put_object(Bucket=bucket, Key=key, Body=content, ContentType='application/json',
                          Metadata={'sha256': sha256(content)}, **extra)
    except Exception as error:
        code = getattr(error, 'response', {}).get('Error', {}).get('Code')
        if not immutable or code not in ('PreconditionFailed', '412'):
            raise
        # Another writer is acceptable only if it published identical output.
    read_verified(client, bucket, key, sha256(content), len(content))


def audio_identity(call):
    name, digest, size = call['original_filename'], call.get('sha256'), call.get('size_bytes')
    if not re.fullmatch(r'dcfems-\d+-\d+\.m4a', name):
        raise ValueError('Invalid audio filename')
    if not re.fullmatch(r'[0-9a-f]{64}', digest or '') or not isinstance(size, int) or size <= 0:
        raise ValueError('Missing audio checksum or size')
    return {'filename': name, 'sha256': digest, 'size_bytes': size}


def valid_cached(value, identity, configuration):
    if (value.get('schema_version') != 1 or value.get('status') != 'decoded'
            or value.get('audio') != identity or value.get('configuration') != configuration):
        raise ValueError('Cached phoneme identity/settings mismatch; refusing to overwrite')
    for lang in SETTINGS['inventories']:
        output = value['outputs'][lang]
        if output['sequence'] != ' '.join(f['phone'] for f in output['frames']):
            raise ValueError('Cached sequence/timestamp mismatch')
    return value


def source_audio(client, bucket, folder, call):
    from r2_audio import read_verified, stored_audio
    identity = audio_identity(call)
    if stored_audio(call, folder.name):
        storage = call['audio_storage']
        # Read only the configured archive bucket; never source recordings elsewhere.
        if storage['bucket'] != bucket:
            raise ValueError('Configured R2 bucket differs from source audio bucket')
        return read_verified(client, bucket, storage['key'], identity['sha256'], identity['size_bytes'])
    local = folder / identity['filename']
    if local.is_file():
        content = local.read_bytes()
        if len(content) != identity['size_bytes'] or sha256(content) != identity['sha256']:
            raise ValueError('Local audio checksum/size mismatch')
        return content
    raise ValueError('No verified R2 audio or local recording')


def run_day(args):
    from r2_audio import client_and_bucket
    folder = archive_path(args.root, args.day, args.talkgroup)
    archive_bytes = (folder / 'calls.json').read_bytes()
    data = json.loads(archive_bytes)
    if data['date'] != args.day or data['talkgroup'] != args.talkgroup:
        raise ValueError('Archive identity mismatch')
    calls = data['calls']
    model_path = ensure_model(args.model_dir)
    configuration = {'model': MODEL, 'model_sha256': MODEL_SHA256,
                     'library': 'allosaurus', 'settings': SETTINGS,
                     'runtime': runtime_versions()}
    base = prefix(args.talkgroup, args.day, configuration)
    client, bucket = client_and_bucket() if args.publish else (None, None)
    args.output.mkdir(parents=True, exist_ok=True)
    result = {'schema_version': 1, 'date': args.day, 'talkgroup': args.talkgroup,
              'configuration': configuration, 'source_calls_sha256': sha256(archive_bytes),
              'source_commit': os.environ.get('GITHUB_SHA'), 'clips': [],
              'processed_at': datetime.now(timezone.utc).isoformat(),
              'r2_bucket': bucket, 'r2_prefix': base}
    engine = None
    counters = Counter()

    def checkpoint(final=False):
        result['counts'] = dict(counters)
        result['total_clips'] = len(calls)
        result['attempted_all'] = final
        result['complete'] = final and counters['decoded'] == len(calls)
        content = encoded(result)
        local = args.output / 'phonemes.json'
        tmp = local.with_suffix('.json.tmp')
        tmp.write_bytes(content)
        tmp.replace(local)
        if args.publish:
            publish(client, bucket, base + '/phonemes.json', content)

    for number, call in enumerate(calls, 1):
        clip = {'clip_number': number, 'call_id': call.get('id'),
                'filename': call.get('original_filename'), 'sha256': call.get('sha256'),
                'timestamp_mountain': call.get('timestamp_mountain'),
                'radio_ids': call.get('radio_ids', [])}
        try:
            if call.get('audio_status') == 'unavailable':
                clip.update(status='unavailable', reason='Archive marks source audio unavailable')
                counters['unavailable'] += 1
            else:
                identity = audio_identity(call)
                key = f"{base}/clips/{identity['filename'][:-4]}--{identity['sha256']}.json"
                local_key = args.output / 'clips' / (key.rsplit('/', 1)[1])
                previous = read_optional(client, bucket, key) if args.publish else (
                    local_key.read_bytes() if local_key.exists() else None)
                if previous is not None:
                    record = valid_cached(json.loads(previous), identity, configuration)
                    counters['reused'] += 1
                else:
                    if args.publish:
                        content = source_audio(client, bucket, folder, call)
                    else:
                        # Local smoke tests do not require credentials.
                        local_source = folder / identity['filename']
                        content = local_source.read_bytes()
                        if sha256(content) != identity['sha256'] or len(content) != identity['size_bytes']:
                            raise ValueError('Local audio checksum/size mismatch')
                    if engine is None:
                        engine = recognizer(model_path)
                    with tempfile.TemporaryDirectory(prefix='radio-phonemes-') as temporary:
                        original, wav = Path(temporary) / 'audio.m4a', Path(temporary) / 'audio.wav'
                        original.write_bytes(content)
                        subprocess.run(['ffmpeg', '-nostdin', '-hide_banner', '-loglevel', 'error',
                                        '-y', '-i', str(original), '-ac', '1', '-ar', '16000',
                                        '-c:a', 'pcm_s16le', str(wav)], check=True,
                                       capture_output=True, timeout=120)
                        outputs = {lang: timed_phones(engine.recognize(str(wav), lang,
                                   topk=1, emit=1.0, timestamp=True)) for lang in SETTINGS['inventories']}
                    record = {'schema_version': 1, 'status': 'decoded', 'audio': identity,
                              'configuration': configuration, 'outputs': outputs,
                              'human_verified': False}
                    content = encoded(record)
                    if args.publish:
                        publish(client, bucket, key, content, immutable=True)
                    else:
                        local_key.parent.mkdir(parents=True, exist_ok=True)
                        local_key.write_bytes(content)
                    counters['new'] += 1
                clip.update(status='decoded', result_key=key,
                            result_sha256=sha256(encoded(record)))
                if not args.publish:
                    clip['local_result'] = str(local_key)
                counters['decoded'] += 1
        except Exception as error:
            clip.update(status='error', error=f'{type(error).__name__}: {error}')
            counters['error'] += 1
        result['clips'].append(clip)
        # Every successfully decoded clip was already saved independently.
        if number % args.checkpoint_every == 0:
            checkpoint()
            print(json.dumps({'day': args.day, 'talkgroup': args.talkgroup,
                              'processed': number, 'total': len(calls), **counters}), flush=True)
    checkpoint(final=True)
    print(json.dumps({'day': args.day, 'talkgroup': args.talkgroup,
                      'total': len(calls), 'r2_prefix': base, **counters}), flush=True)
    summary = (f"## Phonemes: {args.talkgroup} / {args.day}\n\n"
               f"Total: {len(calls)}; decoded: {counters['decoded']}; reused: {counters['reused']}; "
               f"new: {counters['new']}; unavailable: {counters['unavailable']}; errors: {counters['error']}.\n\n"
               f"R2 bucket: `{bucket}`\n\nPrefix: `{base}`\n")
    (args.output / 'report.md').write_text(summary)
    if os.environ.get('GITHUB_STEP_SUMMARY'):
        with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as stream:
            stream.write(summary)
    return 1 if counters['error'] else 0


def workflow_plan(args):
    source_sha = subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True,
                                         cwd=args.root).strip()
    if os.environ['GITHUB_EVENT_NAME'] == 'push':
        event = json.loads(Path(os.environ['GITHUB_EVENT_PATH']).read_text())
        before, after = event.get('before'), event['after']
        command = (['git', 'diff', '--name-only', before, after]
                   if before and set(before) != {'0'} else
                   ['git', 'show', '--pretty=format:', '--name-only', after])
        changed = subprocess.check_output(command, text=True, cwd=args.root).splitlines()
        if REQUEST not in changed:
            with open(os.environ['GITHUB_OUTPUT'], 'a') as stream:
                stream.write('has_work=false\n')
            return
        request = json.loads((args.root / REQUEST).read_bytes())
    else:
        request = {'days': os.environ.get('INPUT_DAYS') or 'all',
                   'talkgroups': os.environ.get('INPUT_TALKGROUPS') or 'all',
                   'batch_index': int(os.environ.get('INPUT_BATCH_INDEX') or 0)}
    result = plan(args.root, request.get('days', 'all'), request.get('talkgroups', 'all'),
                  int(request.get('batch_index', 0)))
    with open(os.environ['GITHUB_OUTPUT'], 'a') as stream:
        stream.write('has_work=true\n')
        stream.write('source_sha=' + source_sha + '\n')
        stream.write('matrix=' + json.dumps({'include': result['include']}) + '\n')
    print(json.dumps(result), flush=True)
    if result['batch_count'] > 1:
        print(f"Selection needs {result['batch_count']} batches; this run is batch {result['batch_index']}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=ROOT)
    sub = parser.add_subparsers(dest='command', required=True)
    p = sub.add_parser('plan')
    p.add_argument('--days', default='all')
    p.add_argument('--talkgroups', default='all')
    p.add_argument('--batch-index', type=int, default=0)
    sub.add_parser('workflow-plan')
    r = sub.add_parser('run')
    r.add_argument('--day', required=True, type=valid_day)
    r.add_argument('--talkgroup', required=True, type=valid_talkgroup)
    r.add_argument('--publish', action='store_true')
    r.add_argument('--model-dir', type=Path, required=True)
    r.add_argument('--output', type=Path, required=True)
    r.add_argument('--checkpoint-every', type=int, default=100)
    args = parser.parse_args()
    if args.command == 'plan':
        print(json.dumps(plan(args.root, args.days, args.talkgroups, args.batch_index)))
    elif args.command == 'workflow-plan':
        workflow_plan(args)
    else:
        if args.checkpoint_every < 1:
            parser.error('checkpoint-every must be positive')
        return run_day(args)
    return 0


if __name__ == '__main__':
    sys.exit(main())
