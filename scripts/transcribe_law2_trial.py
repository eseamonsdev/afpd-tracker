#!/usr/bin/env python3
"""Law 2 three-pass candidate generation; publication requires AI review.

Original and filtered modes may run independently in parallel. Context mode
requires both completed passes. Raw ASR never writes the authoritative calls.json.
"""
import argparse
import copy
import hashlib
import importlib.metadata
import json
import math
import re
from pathlib import Path
import subprocess
import tempfile
import time
from datetime import datetime
from zoneinfo import ZoneInfo

from transcribe_afpd_radio import context_indices, read, sha, write

ROOT = Path(__file__).resolve().parents[1]
SETTINGS = Path(__file__).with_name('radio-transcription-settings.json')
DAY = '2026-10-01'
TALKGROUP = 5922
KINDS = ('original', 'filtered', 'context')


def load_archive(root):
    folder = root / 'public/records/openmhz' / f'openmhz-afpd-law-2-{DAY}'
    data = read(folder / 'calls.json')
    calls = data['calls']
    if data.get('date') != DAY or data.get('talkgroup') != TALKGROUP:
        raise ValueError('Wrong Law 2 date/talkgroup')
    if not calls or data.get('count') != len(calls):
        raise ValueError('Empty archive or inconsistent count')
    names = [c['original_filename'] for c in calls]
    if len(set(names)) != len(names):
        raise ValueError('Duplicate audio filename')
    if [c['epoch'] for c in calls] != sorted(c['epoch'] for c in calls):
        raise ValueError('Calls must be chronological')
    from r2_audio import hydrate
    hydrate(folder)
    for c in calls:
        name = c['original_filename']
        if name != f"dcfems-{TALKGROUP}-{c['epoch']}.m4a":
            raise ValueError('Filename/epoch mismatch')
        if datetime.fromtimestamp(c['epoch'], ZoneInfo('America/Denver')).date().isoformat() != DAY:
            raise ValueError('Wrong Mountain date')
        if not c.get('sha256') or sha(folder / name) != c['sha256']:
            raise ValueError('Missing audio or checksum mismatch: ' + name)
    # coverage=unknown is preserved: all archived audio is processed, not a claim
    # that every source transmission was received or every download succeeded.
    return folder, data


def manifest_signature(data):
    return hashlib.sha256(json.dumps(
        [(c['original_filename'], c['sha256'], c['epoch']) for c in data['calls']],
        separators=(',', ':')).encode()).hexdigest()


def validate_pass(state, kind, data, cfg, signature):
    names = {c['original_filename'] for c in data['calls']}
    if (state.get('date') != DAY or state.get('talkgroup') != TALKGROUP
            or state.get('kind') != kind or state.get('settings') != cfg
            or state.get('settings_sha256') != hashlib.sha256(SETTINGS.read_bytes()).hexdigest()
            or state.get('manifest_signature') != signature
            or set(state.get('clips', {})) != names):
        raise ValueError('Incomplete or mismatched ' + kind + ' pass')
    for c in data['calls']:
        item = state['clips'][c['original_filename']]
        if item.get('sha256') != c['sha256'] or kind not in item.get('passes', {}):
            raise ValueError('Pass/audio identity mismatch')


def run(kind, root, work, model_dir):
    from faster_whisper import WhisperModel
    cfg = read(SETTINGS)
    if importlib.metadata.version('faster-whisper') != cfg['engine_version']:
        raise ValueError('Install the pinned faster-whisper version')
    root, work = root.resolve(), work.resolve()
    if work.is_relative_to(root):
        raise ValueError('Raw candidates must be outside the repository')
    folder, data = load_archive(root)
    signature = manifest_signature(data)
    settings_signature = hashlib.sha256(SETTINGS.read_bytes()).hexdigest()
    original = filtered = None
    if kind == 'context':
        original, filtered = [read(work / (k + '.json')) for k in KINDS[:2]]
        for k, state in [('original', original), ('filtered', filtered)]:
            validate_pass(state, k, data, cfg, signature)
    output = work / (kind + '.json')
    state = read(output) if output.exists() else {
        'date': DAY, 'talkgroup': TALKGROUP, 'kind': kind,
        'settings': cfg, 'settings_sha256': settings_signature,
        'manifest_signature': signature, 'clips': {}, 'elapsed_seconds': 0}
    if (state.get('settings') != cfg or state.get('manifest_signature') != signature
            or state.get('kind') != kind or state.get('date') != DAY
            or state.get('talkgroup') != TALKGROUP):
        raise ValueError('Checkpoint belongs to a different run configuration')
    started = time.monotonic()
    prior_elapsed = state.get('elapsed_seconds', 0)
    model = WhisperModel(cfg['model'], device=cfg['device'],
                         compute_type=cfg['compute_type'], cpu_threads=cfg['cpu_threads'],
                         download_root=str(model_dir))
    calls = data['calls']
    for i, c in enumerate(calls):
        name = c['original_filename']
        if name in state['clips']:
            if state['clips'][name].get('sha256') != c['sha256']:
                raise ValueError('Checkpoint audio mismatch')
            continue
        source = folder / name
        duration = float(subprocess.check_output([
            'ffprobe', '-v', 'error', '-show_entries', 'format=duration',
            '-of', 'default=noprint_wrappers=1:nokey=1', str(source)], text=True))
        if not math.isfinite(duration) or duration <= 0:
            raise ValueError('Invalid audio duration')
        prompt = None
        context_names = []
        if kind == 'context':
            context_names = [calls[j]['original_filename']
                             for j in context_indices(calls, i, cfg)]
            prompt = ' '.join(original['clips'][n]['passes']['original']['text']
                              for n in context_names).strip()[-cfg['context_max_characters']:] or None
        limit = min(cfg['token_limit_max'], max(cfg['token_limit_base'],
                    math.ceil(cfg['token_limit_base'] + cfg['token_limit_per_second'] * duration)))
        with tempfile.TemporaryDirectory(prefix='law2-filter-') as tmp:
            if kind == 'filtered':
                target = Path(tmp) / 'filtered.wav'
                subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-y', '-i', str(source),
                                '-af', cfg['filter'], '-ar', str(cfg['sample_rate']),
                                '-ac', '1', str(target)], check=True)
                source = target
            segments, info = model.transcribe(str(source), language=cfg['language'],
                beam_size=cfg['beam_size'], temperature=cfg['temperature'],
                condition_on_previous_text=cfg['condition_on_previous_text'],
                vad_filter=cfg['vad_filter'], initial_prompt=prompt,
                max_new_tokens=limit, word_timestamps=True)
            segments = list(segments)
        token_count = sum(len(s.tokens) for s in segments)
        result = {
            'text': ' '.join(s.text.strip() for s in segments).strip(),
            'prompt': prompt, 'context_filenames': context_names,
            'duration_seconds': duration, 'token_limit': limit,
            'token_count': token_count, 'token_cap_reached': token_count >= limit,
            'segments': [{'start': s.start, 'end': s.end, 'text': s.text,
                          'avg_logprob': s.avg_logprob, 'no_speech_prob': s.no_speech_prob,
                          'compression_ratio': s.compression_ratio,
                          'words': [{'word': w.word, 'probability': w.probability}
                                    for w in (s.words or [])]} for s in segments]}
        state['clips'][name] = {'index': i + 1, 'sha256': c['sha256'],
                                'epoch': c['epoch'], 'passes': {kind: result}}
        state['elapsed_seconds'] = prior_elapsed + time.monotonic() - started
        write(output, state)
        if (i + 1) % 25 == 0 or i + 1 == len(calls):
            print(f'{DAY} {kind}: {i + 1}/{len(calls)} clips; '
                  f'{state["elapsed_seconds"]:.1f} seconds', flush=True)
    validate_pass(state, kind, data, cfg, signature)
    if kind == 'context':
        merge(work, data, cfg, signature)


def merge(work, data, cfg, signature):
    states = {k: read(work / (k + '.json')) for k in KINDS}
    for kind, state in states.items():
        validate_pass(state, kind, data, cfg, signature)
    merged = {k: states['original'][k] for k in
              ['date', 'talkgroup', 'settings', 'settings_sha256', 'manifest_signature']}
    merged['clips'] = {}
    for c in data['calls']:
        name = c['original_filename']
        record = {k: states['original']['clips'][name][k] for k in ['index', 'sha256', 'epoch']}
        record['passes'] = {k: states[k]['clips'][name]['passes'][k] for k in KINDS}
        merged['clips'][name] = record
    write(work / 'passes.json', merged)
    summary = {
        'date': DAY, 'talkgroup': TALKGROUP, 'archived_clips': len(data['calls']),
        'source_coverage': data.get('coverage'),
        'audio_seconds': sum(c['audio_duration_seconds'] for c in data['calls']),
        'pass_elapsed_seconds': {k: s['elapsed_seconds'] for k, s in states.items()},
        'empty_pass_counts': {k: sum(not c['passes'][k]['text'] for c in merged['clips'].values())
                              for k in KINDS},
        'disagreement_clips': sum(len({p['text'].casefold().strip() for p in c['passes'].values()}) > 1
                                  for c in merged['clips'].values()),
        'token_cap_clips': sum(any(p['token_cap_reached'] for p in c['passes'].values())
                              for c in merged['clips'].values()),
        'publication_status': 'awaiting_AI_reconciliation',
        'authoritative_manifest_modified': False}
    write(work / 'summary.json', summary)
    print(json.dumps(summary, indent=2), flush=True)


def finalize(root, passes_path, reviewed_path):
    """Publish only separately reconciled entries, preserving all other metadata."""
    folder, data = load_archive(root.resolve())
    cfg = read(SETTINGS)
    state, reviewed = read(passes_path), read(reviewed_path)
    signature = manifest_signature(data)
    settings_signature = hashlib.sha256(SETTINGS.read_bytes()).hexdigest()
    if (state.get('settings') != cfg or state.get('settings_sha256') != settings_signature
            or state.get('manifest_signature') != signature or state.get('date') != DAY
            or state.get('talkgroup') != TALKGROUP):
        raise ValueError('Wrong pass settings/audio/date')
    if (reviewed.get('date') != DAY or reviewed.get('talkgroup') != TALKGROUP
            or reviewed.get('settings_sha256') != settings_signature
            or reviewed.get('manifest_signature') != signature):
        raise ValueError('Wrong review provenance')
    entries = reviewed['entries']
    names = {c['original_filename'] for c in data['calls']}
    if len(entries) != len(names) or {e['filename'] for e in entries} != names:
        raise ValueError('Review must cover every clip exactly once')
    if set(state['clips']) != names:
        raise ValueError('Incomplete passes')
    by_name = {e['filename']: e for e in entries}
    updated = copy.deepcopy(data)
    for c in updated['calls']:
        name = c['original_filename']
        item, entry = state['clips'][name], by_name[name]
        if item.get('sha256') != c['sha256'] or set(item['passes']) != set(KINDS):
            raise ValueError('Missing or mismatched pass')
        if c.get('transcript') or c.get('validated'):
            raise ValueError('Existing transcript/validation must be preserved')
        text = entry['text'].strip()
        if not text or '\n' in text or not isinstance(entry.get('needs_review'), bool):
            raise ValueError('Invalid reviewed transcript')
        if entry['needs_review'] and not re.search(
                r'[\[\]]|\b(?:unclear|unintelligible|inaudible|uncertain)\b', text, re.I):
            raise ValueError('Uncertainty must remain visible in the transcript text')
        if any(p['token_cap_reached'] for p in item['passes'].values()) and not entry['needs_review']:
            raise ValueError('Token-capped clip must retain uncertainty')
        c['transcript'] = text
    updated['enableTranscription'] = True
    write(folder / 'calls.json', updated)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('kind', choices=(*KINDS, 'finalize'))
    parser.add_argument('--date', default=DAY, help='Mountain archive date (YYYY-MM-DD)')
    parser.add_argument('--root', type=Path, default=ROOT)
    parser.add_argument('--work-dir', type=Path)
    parser.add_argument('--model-dir', type=Path)
    parser.add_argument('--passes', type=Path)
    parser.add_argument('--reviewed', type=Path)
    args = parser.parse_args()
    try:
        if datetime.strptime(args.date, '%Y-%m-%d').date().isoformat() != args.date:
            raise ValueError('Noncanonical date')
    except ValueError:
        parser.error('--date must be a valid YYYY-MM-DD date')
    DAY = args.date
    if args.kind == 'finalize':
        if not args.passes or not args.reviewed:
            parser.error('finalize requires --passes and --reviewed')
        finalize(args.root, args.passes, args.reviewed)
    else:
        if not args.work_dir or not args.model_dir:
            parser.error('ASR requires --work-dir and --model-dir')
        run(args.kind, args.root, args.work_dir, args.model_dir)
