#!/usr/bin/env python3
"""R2-only ASR for any supported date, talkgroup and working branch.

Never edits calls.json or sets human verification. No audio enters Git/artifacts.
"""
import argparse
import datetime as dt
import hashlib
import importlib.metadata
import json
import math
import os
import re
import random
from pathlib import Path
import shutil
import subprocess
import time

from radio_config import valid_branch, valid_talkgroup
from r2_audio import client_and_bucket, read_verified, stored_audio
from transcribe_afpd_radio import ROOT, SETTINGS, context_indices, load_archive, read, write

KINDS = {'original', 'filtered', 'context'}


def radio_ids(call):
    values = (call.get('radio_ids') or []) + [s.get('src') for s in (call.get('srcList') or [])]
    return {str(value) for value in values if re.fullmatch(r'[1-9]\d*', str(value))}


def selected_indices(data, selection='all'):
    if selection == 'all':
        return list(range(len(data['calls'])))
    if selection == 'missing':
        return [i for i, call in enumerate(data['calls'])
                if call.get('validated') is not True
                and not (isinstance(call.get('transcript'), str) and call['transcript'].strip())]
    if selection == 'dispatch_missing':
        if data['talkgroup'] != 5922:
            raise ValueError('Dispatch selection requires Law 2')
        # Same owner-configured 904 prefix used by the radio player.
        return [i for i, call in enumerate(data['calls'])
                if any(value.startswith('904') for value in radio_ids(call))
                and call.get('validated') is not True
                and not (isinstance(call.get('transcript'), str) and call['transcript'].strip())]
    if selection != 'afpd_missing' or data['talkgroup'] != 5922:
        raise ValueError('AFPD missing selection is supported only for Law 2')
    # Same association rule as the Law 2 player index; no speaker inference.
    corrections = read(ROOT / 'data/radio-agency-corrections.json')
    ids = set()
    for path in (ROOT / 'public/records/openmhz').glob('openmhz-afpd-car-to-car-*/calls.json'):
        source = read(path)
        if source.get('talkgroup') != 6001:
            continue
        for call in source['calls']:
            if call.get('talkgroup', 6001) == 6001:
                ids.update(radio_ids(call))
    ids = {value for value in ids if corrections.get(value, {}).get('afpd') is not False}
    return [i for i, call in enumerate(data['calls'])
            if radio_ids(call) & ids and call.get('validated') is not True
            and not (isinstance(call.get('transcript'), str) and call['transcript'].strip())]


def available_targets(folder, data, targets, cfg, clips):
    """Leave unavailable selected audio pending without stopping other clips."""
    ready, blocked = [], []
    for index in targets:
        call = data['calls'][index]
        if completed(clips.get(call['original_filename'], {})):
            ready.append(index)
            continue
        required = [index] + [
            j for j in context_indices(data['calls'], index, cfg)
            if 'original' not in clips.get(data['calls'][j]['original_filename'], {}).get('passes', {})
        ]
        if all(stored_audio(data['calls'][j], folder) for j in required):
            ready.append(index)
        else:
            blocked.append(index)
    return ready, blocked


def validate_record(call, record, index):
    if (record.get('sha256') != call['sha256'] or record.get('epoch') != call['epoch']
            or record.get('index') != index + 1):
        raise ValueError('Checkpoint audio identity changed: ' + call['original_filename'])
    if not set(record.get('passes', {})) <= KINDS:
        raise ValueError('Unknown checkpoint pass')


def restore(directory, data, signature):
    clips = {}
    calls = {c['original_filename']: (i, c) for i, c in enumerate(data['calls'])}
    for path in sorted(directory.glob('batch-*.json')):
        saved = read(path)
        if (saved['date'] != data['date'] or saved['settings_sha256'] != signature
                or saved.get('talkgroup', 6001) != data.get('talkgroup', 6001)):
            raise ValueError('Checkpoint date/settings differ: ' + str(path))
        for name, record in saved['clips'].items():
            if name not in calls or name in clips:
                raise ValueError('Unknown/duplicate checkpoint clip: ' + name)
            i, call = calls[name]
            validate_record(call, record, i)
            clips[name] = record
    return clips


def completed(record):
    return set(record.get('passes', {})) == KINDS


def cleanup_audio(directory):
    # Only the explicit temporary audio directory; never touches R2 or repo files.
    if directory.exists():
        shutil.rmtree(directory)


def checkpoint(directory, data, cfg, signature, clips, batch_size, status):
    calls = data['calls']
    for start in range(0, len(calls), batch_size):
        selected = {c['original_filename']: clips[c['original_filename']]
                    for c in calls[start:start + batch_size] if c['original_filename'] in clips}
        if not selected:
            continue
        write(directory / f'batch-{start // batch_size + 1:03d}.json', {
            'schema_version': 1, 'date': data['date'], 'talkgroup': data.get('talkgroup', 6001),
            'settings_sha256': signature, 'settings': cfg,
            'clips': selected})
    done = sum(completed(clips.get(c['original_filename'], {})) for c in calls)
    write(directory / 'status.json', {
        'date': data['date'], 'talkgroup': data.get('talkgroup', 6001), 'total_clips': len(calls),
        'three_pass_clips': done, 'remaining_clips': len(calls) - done,
        'state': status, 'updated_at': dt.datetime.now(dt.timezone.utc).isoformat(),
        'reconciled': False, 'audio_saved_in_repository': False})
    return done


def commit_checkpoint(directory, day, done, total, talkgroup=6001, target_branch='staging'):
    valid_talkgroup(talkgroup)
    valid_branch(target_branch)
    relative = directory.relative_to(ROOT).as_posix()
    subprocess.run(['git', 'add', '--', relative], cwd=ROOT, check=True)
    changed = subprocess.run(['git', 'diff', '--cached', '--quiet', '--', relative], cwd=ROOT)
    if changed.returncode == 0:
        return
    if changed.returncode != 1:
        raise RuntimeError('Unable to inspect checkpoint changes')
    # Explicit path limits the commit to text checkpoints, even if other files are staged.
    subprocess.run(['git', 'commit', '-m', f'Checkpoint {talkgroup} {day}: {done}/{total} three-pass clips',
                    '--', relative], cwd=ROOT, check=True)
    for attempt in range(30):
        subprocess.run(['git', 'fetch', 'origin', target_branch], cwd=ROOT, check=True)
        subprocess.run(['git', 'rebase', 'origin/' + target_branch], cwd=ROOT, check=True)
        if subprocess.run(['git', 'push', 'origin', 'HEAD:' + target_branch], cwd=ROOT).returncode == 0:
            print(f'CHECKPOINT COMMITTED: {done}/{total} clips; text only.', flush=True)
            return
        time.sleep(random.uniform(1, 5))
    raise RuntimeError('Checkpoint push failed; previous committed batches remain safe')


def run(args):
    from faster_whisper import WhisperModel
    cfg = read(SETTINGS)
    if importlib.metadata.version('faster-whisper') != cfg['engine_version']:
        raise ValueError('Install scripts/requirements-radio.txt')
    if args.batch_size < 1:
        raise ValueError('Checkpoint interval must be positive')
    valid_branch(args.target_branch)
    valid_talkgroup(args.talkgroup)
    folder, data = load_archive(args.date, args.talkgroup, require_complete=False)
    calls = data['calls']
    if data['count'] != len(calls):
        raise ValueError('Archive count mismatch')
    signature = hashlib.sha256(SETTINGS.read_bytes()).hexdigest()
    directory = ROOT / 'transcription-work' / str(args.talkgroup) / args.date
    clips = restore(directory, data, signature)
    selection = getattr(args, 'selection', 'all')
    targets = selected_indices(data, selection)
    print(f'SELECTION: {selection}; {len(targets)} target clips; full archive indices/context preserved.', flush=True)
    blocked = []
    if selection in ('afpd_missing', 'dispatch_missing', 'missing'):
        targets, blocked = available_targets(folder.name, data, targets, cfg, clips)
        print(f'AUDIO SELECTION: {len(targets)} available targets; {len(blocked)} pending unavailable target/context audio.', flush=True)
    if not targets or all(completed(clips.get(calls[i]["original_filename"], {})) for i in targets):
        print('All available selected clips already saved; no ASR required.', flush=True)
        return
    # Count new work toward each checkpoint, excluding already saved targets.
    targets = [i for i in targets if not completed(clips.get(calls[i]['original_filename'], {}))]
    batch_size = (min(args.batch_size, 100) if selection in ('dispatch_missing', 'missing')
                  else min(args.batch_size, 10) if selection == 'afpd_missing'
                  else args.batch_size)
    audio = Path(args.audio_dir).resolve()
    if audio.is_relative_to(ROOT) or not audio.name.startswith(('radio-audio-', f'{args.talkgroup}-audio-')):
        raise ValueError('Use a dedicated radio-audio-* temporary directory outside the repository')
    client, bucket = client_and_bucket()
    print(f'R2 PREFLIGHT: checking saved audio for {args.date}; {len(calls)} clips.', flush=True)
    probe = calls[targets[0]]
    if not stored_audio(probe, folder.name) or probe['audio_storage']['bucket'] != bucket:
        raise ValueError('Invalid saved R2 metadata')
    read_verified(client, bucket, probe['audio_storage']['key'], probe['sha256'], probe['size_bytes'])
    print('R2 PREFLIGHT PASSED: object read, size and SHA-256 verified.', flush=True)
    print(f'Loading {cfg["model"]}; resuming {sum(completed(x) for x in clips.values())}/{len(calls)} clips.', flush=True)
    model = WhisperModel(cfg['model'], device=cfg['device'], compute_type=cfg['compute_type'],
                         cpu_threads=cfg['cpu_threads'], download_root=args.model_dir)
    print('MODEL READY', flush=True)

    def process(index, kind):
        call = calls[index]
        name = call['original_filename']
        record = clips.setdefault(name, {'index': index + 1, 'epoch': call['epoch'],
                                         'sha256': call['sha256'], 'passes': {}})
        if kind in record['passes']:
            return
        started = time.monotonic()
        print(f'{args.date} clip {index + 1}/{len(calls)}: {kind} START', flush=True)
        audio.mkdir(parents=True, exist_ok=True)
        source = audio / name
        if not source.exists():
            if not stored_audio(call, folder.name) or call['audio_storage']['bucket'] != bucket:
                raise ValueError('Missing verified R2 source: ' + name)
            content = read_verified(client, bucket, call['audio_storage']['key'], call['sha256'], call['size_bytes'])
            source.write_bytes(content)
        duration = float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries',
            'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', str(source)], text=True))
        filtered = audio / (name + '.wav')
        if kind == 'filtered':
            subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-y', '-i', str(source),
                '-af', cfg['filter'], '-ar', str(cfg['sample_rate']), '-ac', '1', str(filtered)], check=True)
            source = filtered
        prompt = None
        if kind == 'context':
            prior = [clips[calls[j]['original_filename']]['passes']['original']['text']
                     for j in context_indices(calls, index, cfg)]
            prompt = ' '.join(t for t in prior if t).strip()[-cfg['context_max_characters']:] or None
        limit = min(cfg['token_limit_max'], max(cfg['token_limit_base'],
                    math.ceil(cfg['token_limit_base'] + cfg['token_limit_per_second'] * duration)))
        segments, _ = model.transcribe(str(source), language=cfg['language'], beam_size=cfg['beam_size'],
            temperature=cfg['temperature'], condition_on_previous_text=cfg['condition_on_previous_text'],
            vad_filter=cfg['vad_filter'], initial_prompt=prompt, max_new_tokens=limit)
        segments = list(segments)
        tokens = sum(len(s.tokens) for s in segments)
        record['passes'][kind] = {
            'text': ' '.join(s.text.strip() for s in segments).strip(), 'prompt': prompt,
            'duration_seconds': duration, 'token_limit': limit, 'token_count': tokens,
            'token_cap_reached': tokens >= limit,
            'segments': [{'start': s.start, 'end': s.end, 'text': s.text, 'avg_logprob': s.avg_logprob,
                          'no_speech_prob': s.no_speech_prob, 'compression_ratio': s.compression_ratio}
                         for s in segments]}
        print(f'{args.date} clip {index + 1}/{len(calls)}: {kind} COMPLETE ({time.monotonic() - started:.1f}s)', flush=True)

    try:
        batches = math.ceil(len(targets) / batch_size)
        for start in range(0, len(targets), batch_size):
            selected = targets[start:start + batch_size]
            batch = start // batch_size + 1
            if all(completed(clips.get(calls[i]['original_filename'], {})) for i in selected):
                print(f'Batch {batch}/{batches}: already saved; SKIP.', flush=True)
                continue
            print(f'BATCH {batch}/{batches}: clips {selected[0] + 1}-{selected[-1] + 1}/{len(calls)}', flush=True)
            required = sorted(set(selected) | {j for i in selected for j in context_indices(calls, i, cfg)})
            for i in required:
                process(i, 'original')
            for i in selected:
                process(i, 'filtered')
            for i in selected:
                process(i, 'context')
            done = checkpoint(directory, data, cfg, signature, clips, 10, 'awaiting_reconciliation' if start + batch_size >= len(targets) else 'running')
            commit_checkpoint(directory, args.date, done, len(calls), args.talkgroup, args.target_branch)
            cleanup_audio(audio)
            print(f'Batch {batch}/{batches}: local original and filtered audio DELETED; R2 unchanged.', flush=True)
    except BaseException:
        # Preserve completed passes from the interrupted batch when possible.
        done = checkpoint(directory, data, cfg, signature, clips, 10, 'interrupted')
        commit_checkpoint(directory, args.date, done, len(calls), args.talkgroup, args.target_branch)
        raise
    finally:
        cleanup_audio(audio)
    print(f'ALL SELECTED PASSES SAVED: {len(targets)}/{len(targets)} selected clips; full archive {done}/{len(calls)}. Reconciliation still required; {len(blocked)} selected clips pending unavailable audio; calls.json unchanged.', flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--date', required=True)
    parser.add_argument('--talkgroup', type=int, default=6001)
    parser.add_argument('--target-branch', default='staging')
    parser.add_argument('--selection', choices=['all', 'afpd_missing', 'dispatch_missing', 'missing'], default='all')
    parser.add_argument('--batch-size', type=int, default=200)
    parser.add_argument('--audio-dir', required=True)
    parser.add_argument('--model-dir', required=True)
    run(parser.parse_args())


if __name__ == '__main__':
    main()
