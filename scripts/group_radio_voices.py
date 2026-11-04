#!/usr/bin/env python3
"""Experimental, per-day 6001 speaker groups. Never changes source metadata."""
import argparse
import csv
import hashlib
import json
import math
import os
from pathlib import Path
import re
import subprocess
import tempfile

from radio_config import valid_day

ROOT = Path(__file__).resolve().parents[1]
MODEL = 'speechbrain/spkrec-ecapa-voxceleb'


def select_days(root, selection):
    available = {}
    for path in sorted((root / 'public/records/openmhz').glob('openmhz-afpd-car-to-car-*/calls.json')):
        day = path.parent.name.removeprefix('openmhz-afpd-car-to-car-')
        valid_day(day)
        data = json.loads(path.read_text())
        if data.get('date') != day or data.get('talkgroup') != 6001:
            raise ValueError(f'Archive identity mismatch: {path}')
        available[day] = path
    if selection.strip().lower() == 'all':
        days = list(available)
    else:
        days = sorted({valid_day(d) for d in re.split(r'[,\s]+', selection.strip()) if d})
    if not days:
        raise ValueError('No 6001 dates selected or available')
    missing = set(days) - available.keys()
    if missing:
        raise ValueError('6001 archives not found: ' + ', '.join(sorted(missing)))
    return days


def positive(value):
    number = float(value)
    if not math.isfinite(number) or number <= 0:
        raise ValueError('Minimum speech duration must be positive and finite')
    return number


def similarity_threshold(value):
    number = float(value)
    if not math.isfinite(number) or not 0 < number < 1:
        raise ValueError('Similarity threshold must be between 0 and 1')
    return number


def cluster_vectors(vectors, threshold):
    """Complete linkage prevents a chain of weak matches merging two voices."""
    import numpy as np
    from scipy.cluster.hierarchy import fcluster, linkage
    from scipy.spatial.distance import pdist
    threshold = similarity_threshold(threshold)
    if not vectors:
        return []
    matrix = np.asarray(vectors, dtype=np.float64)
    norms = np.linalg.norm(matrix, axis=1)
    if not np.isfinite(matrix).all() or (norms <= 0).any():
        raise ValueError('Invalid speaker embedding')
    matrix = matrix / norms[:, None]
    if len(matrix) == 1:
        return [1]
    distances = np.clip(pdist(matrix, metric='cosine'), 0, 2)
    labels = fcluster(linkage(distances, method='complete'), 1 - threshold, criterion='distance')
    # Renumber by first clip occurrence, independent of scipy's label ordering.
    names = {}
    return [names.setdefault(int(label), len(names) + 1) for label in labels]


def write_reports(output, result, vectors):
    import numpy as np
    output.mkdir(parents=True, exist_ok=True)
    (output / 'voices.json').write_text(json.dumps(result, indent=2) + '\n')
    fields = ['date', 'clip_number', 'voice', 'status', 'radio_ids', 'speech_seconds',
              'min_group_similarity', 'filename', 'call_id', 'timestamp_mountain', 'error']
    with (output / 'clips.csv').open('w', newline='') as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, extrasaction='ignore')
        writer.writeheader()
        for clip in result['clips']:
            writer.writerow({**clip, 'date': result['date'], 'radio_ids': json.dumps(clip['radio_ids'])})
    accepted = [c for c in result['clips'] if c['status'] == 'embedded']
    np.savez_compressed(output / 'embeddings.npz',
                        clip_numbers=np.asarray([c['clip_number'] for c in accepted]),
                        embeddings=np.asarray(vectors, dtype=np.float32))
    lines = [f"# Suggested voices — {result['date']} / 6001", '',
             'Experimental voice similarity groups; not confirmed people. Labels apply only to this day.', '',
             f"Minimum detected speech: {result['min_speech_seconds']} seconds. "
             f"Minimum within-group cosine similarity: {result['similarity_threshold']} (uncalibrated).", '',
             '| Suggested voice | Original clip numbers |', '| --- | --- |']
    for group in result['groups']:
        lines.append(f"| {group['voice']} | {', '.join(map(str, group['clip_numbers']))} |")
    lines.extend(['', 'Singletons are unassigned because no other clip matched the threshold.', '',
                  f"Accepted: {len(accepted)}. Skipped: {sum(c['status'].startswith('skipped') for c in result['clips'])}. "
                  f"Errors: {sum(c['status'] == 'error' for c in result['clips'])}.", '',
                  'See clips.csv for radio IDs, skipped clips, errors and timestamps. Scores are not identity probabilities.'])
    (output / 'report.md').write_text('\n'.join(lines) + '\n')


def publish_result(path):
    """Upload only the approved per-day voice JSON prefix and verify readback."""
    from r2_audio import client_and_bucket, read_verified
    relative = path.resolve().relative_to(ROOT).as_posix()
    match = re.fullmatch(r'voice-recognition/6001/(\d{4}-\d{2}-\d{2})/voices.json', relative)
    if not match:
        raise ValueError('Unexpected voice output path')
    content = path.read_bytes()
    data = json.loads(content)
    if data.get('date') != valid_day(match[1]) or data.get('talkgroup') != 6001:
        raise ValueError('Voice result identity mismatch')
    digest = hashlib.sha256(content).hexdigest()
    client, bucket = client_and_bucket()
    client.put_object(Bucket=bucket, Key=relative, Body=content,
                      ContentType='application/json', Metadata={'sha256': digest})
    read_verified(client, bucket, relative, digest, len(content))
    print(f'Saved and readback-verified R2 JSON: {relative}', flush=True)


def run_day(args):
    import numpy as np
    import torch
    from huggingface_hub import HfApi
    from silero_vad import get_speech_timestamps, load_silero_vad
    from speechbrain.inference.speaker import EncoderClassifier
    from r2_audio import client_and_bucket, read_verified, stored_audio
    from transcribe_afpd_radio import load_archive

    minimum = positive(args.min_speech)
    threshold = similarity_threshold(args.threshold)
    folder, data = load_archive(args.day, 6001, require_complete=False)
    selected = getattr(args, 'clip_numbers', None)
    if selected:
        selected = {int(n) for n in selected.split(',')}
        if not selected or min(selected) < 1 or max(selected) > len(data['calls']):
            raise ValueError('Selected clip numbers are outside the archive')
        if args.publish:
            raise ValueError('Subset experiments cannot overwrite daily R2 results')
    torch.set_num_threads(2)
    torch.manual_seed(0)
    revision = HfApi().model_info(MODEL).sha
    encoder = EncoderClassifier.from_hparams(source=MODEL, revision=revision,
        savedir=str(Path(args.model_dir) / revision), run_opts={'device': 'cpu'})
    vad = load_silero_vad()
    result = {'schema_version': 1, 'date': args.day, 'talkgroup': 6001,
              'archive_coverage': data.get('coverage'),
              'source_metadata_sha256': hashlib.sha256((folder / 'calls.json').read_bytes()).hexdigest(),
              'model': MODEL, 'model_revision': revision, 'min_speech_seconds': minimum,
              'similarity_threshold': threshold, 'clustering': 'complete-linkage-cosine',
              'human_verified': False, 'status': 'running', 'clips': [], 'groups': []}
    if selected:
        result['selected_clip_numbers'] = sorted(selected)
    output = Path(args.output) / args.day
    vectors = []
    client = bucket = None
    for index, call in enumerate(data['calls'], 1):
        if selected and index not in selected:
            continue
        clip = {'clip_number': index, 'filename': call['original_filename'], 'call_id': call.get('id'),
                'sha256': call.get('sha256'), 'timestamp_mountain': call.get('timestamp_mountain'),
                'radio_ids': call.get('radio_ids', []), 'voice': None, 'status': 'pending'}
        result['clips'].append(clip)
        try:
            if call.get('audio_status') == 'unavailable':
                clip['status'] = 'skipped_unavailable'
                continue
            if not stored_audio(call, folder.name):
                raise ValueError('Audio lacks verified R2 metadata')
            if client is None:
                client, bucket = client_and_bucket()
            if call['audio_storage']['bucket'] != bucket:
                raise ValueError('R2 bucket mismatch')
            content = read_verified(client, bucket, call['audio_storage']['key'], call['sha256'], call['size_bytes'])
            with tempfile.TemporaryDirectory(prefix='radio-speaker-', dir=os.environ.get('RUNNER_TEMP')) as tmp:
                source = Path(tmp) / call['original_filename']
                source.write_bytes(content)
                decoded = subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-i', str(source),
                    '-ar', '16000', '-ac', '1', '-f', 'f32le', 'pipe:1'],
                    check=True, capture_output=True, timeout=120).stdout
                wav = torch.from_numpy(np.frombuffer(decoded, dtype='<f4').copy())
            if not wav.numel() or not torch.isfinite(wav).all():
                raise ValueError('Empty or invalid decoded audio')
            # Measure detected speech without extra boundary padding.
            timestamps = get_speech_timestamps(wav, vad, sampling_rate=16000, speech_pad_ms=0)
            samples = sum(t['end'] - t['start'] for t in timestamps)
            clip['speech_seconds'] = round(samples / 16000, 4)
            if samples < minimum * 16000:
                clip['status'] = 'skipped_short_speech'
                continue
            cleaned = torch.cat([wav[t['start']:t['end']] for t in timestamps])
            with torch.inference_mode():
                vector = encoder.encode_batch(cleaned.unsqueeze(0)).squeeze().cpu().numpy()
            norm = float(np.linalg.norm(vector))
            if not np.isfinite(vector).all() or norm <= 0:
                raise ValueError('Invalid speaker embedding')
            vectors.append(vector / norm)
            # Keep vectors with clip identity so accumulated JSON can be reused.
            clip['embedding'] = (vector / norm).tolist()
            clip['status'] = 'embedded'
        except Exception as exc:
            clip.update(status='error', error=f'{type(exc).__name__}: {exc}')
        finally:
            print(f"{args.day} clip {index}/{len(data['calls'])}: {clip['status']}", flush=True)
            # Lightweight checkpoint survives a later clip failure or job timeout.
            output.mkdir(parents=True, exist_ok=True)
            (output / 'progress.json').write_text(json.dumps(result, indent=2) + '\n')
    accepted = [c for c in result['clips'] if c['status'] == 'embedded']
    labels = cluster_vectors(vectors, threshold)
    for label in sorted(set(labels)):
        members = [i for i, value in enumerate(labels) if value == label]
        voice = f'Voice {label:03d}' if len(members) > 1 else 'Unassigned'
        for i in members:
            accepted[i]['voice'] = voice
            accepted[i]['min_group_similarity'] = (round(min(float(np.dot(vectors[i], vectors[j]))
                for j in members if j != i), 5) if len(members) > 1 else None)
        result['groups'].append({'voice': voice, 'clip_numbers': [accepted[i]['clip_number'] for i in members]})
    errors = sum(c['status'] == 'error' for c in result['clips'])
    result['status'] = 'partial_error' if errors else 'complete'
    write_reports(output, result, vectors)
    if args.publish:
        publish_result(output / 'voices.json')
    if errors:
        raise RuntimeError(f'{errors} clips failed; partial reports saved in {output}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    plan = sub.add_parser('plan')
    plan.add_argument('--days', required=True, help='Comma/space-separated YYYY-MM-DD dates, or all')
    plan.add_argument('--root', type=Path, default=ROOT)
    run = sub.add_parser('run')
    run.add_argument('--day', required=True, type=valid_day)
    run.add_argument('--min-speech', type=positive, default=3.0)
    run.add_argument('--threshold', type=similarity_threshold, default=0.70,
                     help='Uncalibrated cosine cutoff; adjust after listening')
    run.add_argument('--clip-numbers', help='Comma-separated original clip numbers for an artifact-only experiment')
    run.add_argument('--model-dir', default='.cache/radio-speakers')
    run.add_argument('--output', default='voice-recognition/6001')
    run.add_argument('--publish', action='store_true', help='Save daily voices.json to the configured R2 bucket')
    args = parser.parse_args()
    if args.command == 'plan':
        days = select_days(args.root, args.days)
        if len(days) > 256:
            parser.error('Actions supports at most 256 dates per run; split the date selection')
        matrix = json.dumps({'day': days}, separators=(',', ':'))
        print(matrix)
        if os.environ.get('GITHUB_OUTPUT'):
            with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
                output.write('matrix=' + matrix + '\n')
    else:
        run_day(args)


if __name__ == '__main__':
    main()
