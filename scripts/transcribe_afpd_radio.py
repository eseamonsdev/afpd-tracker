#!/usr/bin/env python3
"""Repeatable ASR candidate generation and separately reviewed publication.

Run checkpoints contain raw ASR and belong OUTSIDE the public repository.
The finalizer requires an AI-reconciled entry for every clip; agreement alone
does not publish a candidate or set a human-validation flag.
"""
import argparse
import datetime as dt
import hashlib
import importlib.metadata
import json
import math
import pathlib
import re
import subprocess
from zoneinfo import ZoneInfo

ROOT = pathlib.Path(__file__).resolve().parents[1]
SETTINGS = pathlib.Path(__file__).with_name('radio-transcription-settings.json')


def read(path):
    return json.loads(path.read_text())


def write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + '.tmp')
    temp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
    temp.replace(path)


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def yesterday():
    return (dt.datetime.now(ZoneInfo('America/Denver')).date() - dt.timedelta(days=1)).isoformat()


def archive(date):
    dt.date.fromisoformat(date)
    return ROOT / 'public/records/openmhz' / ('openmhz-afpd-car-to-car-' + date)


def context_indices(calls, index, cfg):
    cutoff = calls[index]['epoch'] - cfg['context_seconds']
    return [j for j in range(max(0, index-cfg['context_calls']), index)
            if cutoff <= calls[j]['epoch'] < calls[index]['epoch']]


def load_archive(date):
    folder = archive(date)
    data = read(folder/'calls.json')
    calls = data['calls']
    if data['date'] != date or data.get('talkgroup') != 6001:
        raise ValueError('Wrong date or talkgroup')
    if data.get('coverage') != 'complete':
        raise ValueError('Target archive is not marked complete; do not substitute another date')
    names = [c['original_filename'] for c in calls]
    if not calls or len(names) != len(set(names)):
        raise ValueError('Empty or duplicate archive')
    if [c['epoch'] for c in calls] != sorted(c['epoch'] for c in calls):
        raise ValueError('Archive order is not chronological')
    for c in calls:
        name = c['original_filename']
        if name != f"dcfems-6001-{c['epoch']}.m4a":
            raise ValueError('Filename/epoch mismatch: ' + name)
        if dt.datetime.fromtimestamp(c['epoch'], ZoneInfo('America/Denver')).date().isoformat() != date:
            raise ValueError('Wrong Mountain date: ' + name)
    return folder, data


def run(args):
    from faster_whisper import WhisperModel
    cfg = read(SETTINGS)
    if importlib.metadata.version('faster-whisper') != cfg['engine_version']:
        raise ValueError('Install the pinned faster-whisper version')
    folder, data = load_archive(args.date)
    work = pathlib.Path(args.work_dir).resolve()
    if work.is_relative_to(ROOT):
        raise ValueError('Raw checkpoint directory must be outside the repository')
    checkpoint = work / args.date / 'passes.json'
    signature = hashlib.sha256(SETTINGS.read_bytes()).hexdigest()
    state = read(checkpoint) if checkpoint.exists() else {
        'date': args.date, 'settings_sha256': signature, 'settings': cfg,
        'engine_version': importlib.metadata.version('faster-whisper'), 'clips': {}}
    if state['date'] != args.date or state['settings_sha256'] != signature:
        raise ValueError('Checkpoint settings differ; use a new work directory')
    calls = data['calls']
    selected = [int(x)-1 for x in args.clips.split(',')] if args.clips else list(range(len(calls)))
    if any(i < 0 or i >= len(calls) for i in selected):
        raise ValueError('Invalid sample index')
    required = sorted(set(selected) | {j for i in selected for j in context_indices(calls, i, cfg)})
    for i in required:
        c = calls[i]; source = folder/c['original_filename']
        digest = sha(source)
        if c.get('sha256') and digest != c['sha256']:
            raise ValueError('Audio checksum mismatch: ' + source.name)
        previous = state['clips'].get(source.name)
        if previous and previous['sha256'] != digest:
            raise ValueError('Audio changed since checkpoint: ' + source.name)
        state['clips'].setdefault(source.name, {'index': i+1, 'sha256': digest, 'epoch': c['epoch'], 'passes': {}})
    write(checkpoint, state)
    model = WhisperModel(cfg['model'], device=cfg['device'], compute_type=cfg['compute_type'],
                         cpu_threads=cfg['cpu_threads'], download_root=args.model_dir)

    def transcribe(i, kind, prompt=None):
        c = calls[i]; name = c['original_filename']; record = state['clips'][name]
        if kind in record['passes']:
            return
        source = folder/name
        duration = float(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration',
                         '-of','default=noprint_wrappers=1:nokey=1',str(source)], text=True))
        if kind == 'filtered':
            source = checkpoint.parent / 'filtered' / (name + '.wav')
            source.parent.mkdir(parents=True, exist_ok=True)
            subprocess.run(['ffmpeg','-nostdin','-v','error','-y','-i',str(folder/name),
                            '-af',cfg['filter'],'-ar',str(cfg['sample_rate']),'-ac','1',str(source)],check=True)
        limit = min(cfg['token_limit_max'], max(cfg['token_limit_base'],
                    math.ceil(cfg['token_limit_base']+cfg['token_limit_per_second']*duration)))
        segments, info = model.transcribe(str(source), language=cfg['language'],
            beam_size=cfg['beam_size'], temperature=cfg['temperature'],
            condition_on_previous_text=cfg['condition_on_previous_text'], vad_filter=cfg['vad_filter'],
            initial_prompt=prompt, max_new_tokens=limit)
        segments = list(segments)
        token_count = sum(len(s.tokens) for s in segments)
        record['passes'][kind] = {
            'text': ' '.join(s.text.strip() for s in segments).strip(),
            'prompt': prompt, 'duration_seconds': duration, 'token_limit': limit,
            'token_count': token_count, 'token_cap_reached': token_count >= limit,
            'segments': [{'start': s.start, 'end': s.end, 'text': s.text,
                          'avg_logprob': s.avg_logprob, 'no_speech_prob': s.no_speech_prob,
                          'compression_ratio': s.compression_ratio} for s in segments]}
        write(checkpoint, state)
        print(f'{args.date} clip {i+1}/{len(calls)} {kind} complete', flush=True)
    for i in required:
        transcribe(i, 'original')
    for i in selected:
        transcribe(i, 'filtered')
    for i in selected:
        prior = [state['clips'][calls[j]['original_filename']]['passes']['original']['text']
                 for j in context_indices(calls, i, cfg)]
        prompt = ' '.join(t for t in prior if t).strip()[-cfg['context_max_characters']:] or None
        transcribe(i, 'context', prompt)
    print('CANDIDATES_READY ' + str(checkpoint), flush=True)


def eligible(text, needs_review):
    return bool(text.strip()) and not needs_review and not re.search(r'[\[\]{}<>]|\b(?:unclear|unintelligible|inaudible|uncertain)\b', text, re.I)


def finalize(args):
    folder, data = load_archive(args.date)
    state = read(pathlib.Path(args.passes)); reviewed = read(pathlib.Path(args.reviewed))
    cfg = read(SETTINGS)
    if state['date'] != args.date or state['settings'] != cfg:
        raise ValueError('Wrong date/settings in passes')
    if reviewed.get('date') != args.date or reviewed.get('settings_sha256') != state['settings_sha256']:
        raise ValueError('Review date/settings mismatch')
    entries = reviewed['entries']
    names = {c['original_filename'] for c in data['calls']}
    if len(entries) != len(names) or {e['filename'] for e in entries} != names:
        raise ValueError('Review must cover every unique filename exactly once')
    by_name = {e['filename']:e for e in entries}
    # This generator establishes a new day's initial documents. Existing days
    # are edited separately under their reviewer/draft rules, never overwritten.
    outputs = [folder/'transcript.md', folder/'transcript-review-backlog.md',
               folder/'transcript-drafts/transcript-draft-1.md']
    if any(p.exists() for p in outputs):
        raise ValueError('Transcript documents already exist; preserve and review them separately')
    lines = []; backlog = []; populated = 0
    for i,c in enumerate(data['calls'],1):
        name=c['original_filename']; e=by_name[name]; raw=state['clips'].get(name,{})
        if set(raw.get('passes',{})) != {'original','filtered','context'} or raw.get('sha256') != c.get('sha256'):
            raise ValueError('Missing passes/checksum mismatch: '+name)
        if sha(folder/name) != raw['sha256']:
            raise ValueError('Audio changed: '+name)
        if c.get('transcript') or c.get('validated'):
            raise ValueError('Existing transcript/validation requires separate preservation review: '+name)
        text=e['text'].strip()
        if not text or '\n' in text or not isinstance(e.get('needs_review'),bool):
            raise ValueError('Invalid reviewed entry: '+name)
        flagged=not eligible(text,e['needs_review'])
        if any(p['token_cap_reached'] for p in raw['passes'].values()) and not flagged:
            raise ValueError('Token-cap affected clip must remain flagged: '+name)
        clock=dt.datetime.fromtimestamp(c['epoch'],ZoneInfo('America/Denver')).strftime('%I:%M:%S %p').lstrip('0')
        line=f"**{i:03d} · {clock} · {c['displayed_seconds']} sec** — [Audio](https://afpd-accountability.com/records/openmhz/{folder.name}/{name}) — {text}"
        lines.append(line)
        if flagged:backlog.append(line)
        else:c['transcript']=text;populated+=1
    title=dt.date.fromisoformat(args.date).strftime('%B %d, %Y').replace(' 0',' ')
    intro=f'# {title} — American Fork PD Car-to-Car transcript\n\nTalkgroup **6001**; **{len(lines)} clips**, in chronological archive order. All timestamps are Mountain Time (America/Denver).\n\n'
    intro+='Whisper small.en, three passes: original audio; filtered audio; original audio with up to three preceding calls within 60 seconds supplied as transcription-text context. All three outputs were reconciled using neighboring conversation. Brackets and review annotations retain uncertainty. This is automated ASR reconciliation, not direct-listening or user validation.\n\n'
    intro+='This run uses the reproducible settings standardized October 16, 2026 in scripts/radio-transcription-settings.json. The exact historical filter and context-gap settings were not recoverable; this preserves the established method with explicitly documented defaults.\n\n'
    transcript=intro+'\n\n'.join(lines)+'\n'
    backlog_text=f'# {title} — Transcript review backlog\n\n**Pending clips: {len(backlog)}**\n\nUnresolved entries are withheld from newly populated calls.json transcript fields. Remove entries only after correction or explicit approval; preserve superseded wording under the established draft rules.\n\n'+'\n\n'.join(backlog)+'\n'
    outputs[2].parent.mkdir(parents=True,exist_ok=True)
    outputs[0].write_text(transcript);outputs[1].write_text(backlog_text);outputs[2].write_text(transcript)
    write(folder/'calls.json',data)
    print(json.dumps({'date':args.date,'three_pass_clips':len(lines),'player_transcripts':populated,'review_backlog':len(backlog)}))


if __name__ == '__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('mode',choices=['run','finalize'])
    parser.add_argument('--date',default=yesterday())
    parser.add_argument('--work-dir')
    parser.add_argument('--model-dir')
    parser.add_argument('--clips',help='Calibration only: comma-separated 1-based clip numbers')
    parser.add_argument('--passes')
    parser.add_argument('--reviewed')
    args=parser.parse_args()
    if args.mode=='run':
        if not args.work_dir:parser.error('--work-dir required')
        run(args)
    else:
        if not args.passes or not args.reviewed:parser.error('--passes and --reviewed required')
        finalize(args)
