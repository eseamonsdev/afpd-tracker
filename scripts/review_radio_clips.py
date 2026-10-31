#!/usr/bin/env python3
"""Text-only targeted model comparison; never edits authoritative transcripts."""
import argparse
import datetime as dt
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

from r2_audio import client_and_bucket, read_verified, stored_audio
from transcribe_afpd_radio import ROOT, load_archive, read, write

MODELS = {
    'police': ('sepiaapps/whisper-small.en-police-radio', True),
    'turbo': ('mobiuslabsgmbh/faster-whisper-large-v3-turbo', False),
    'large-v3': ('Systran/faster-whisper-large-v3', False),
    'small.en': ('Systran/faster-whisper-small.en', False),
    'parakeet': ('nvidia/parakeet-tdt-0.6b-v2', False),
}


def select_calls(data, request):
    selected = {}
    for target in request['targets']:
        index = target['index']
        if not isinstance(index, int) or not 1 <= index <= len(data['calls']):
            raise ValueError('Invalid clip index')
        call = data['calls'][index - 1]
        if call['original_filename'] != target['filename'] or call['sha256'] != target['sha256']:
            raise ValueError('Target filename/hash does not match clip index')
        selected[index] = call
    if not selected or len(selected) > 12:
        raise ValueError('Select 1–12 target clips')
    return selected


def publish(path):
    relative = path.relative_to(ROOT).as_posix()
    subprocess.run(['git', 'add', '--', relative], cwd=ROOT, check=True)
    if subprocess.run(['git', 'diff', '--cached', '--quiet', '--', relative], cwd=ROOT).returncode == 0:
        return
    subprocess.run(['git', 'commit', '-m', 'Save targeted radio model comparison: ' + path.stem,
                    '--', relative], cwd=ROOT, check=True)
    for _ in range(5):
        subprocess.run(['git', 'fetch', 'origin', 'staging'], cwd=ROOT, check=True)
        subprocess.run(['git', 'rebase', 'origin/staging'], cwd=ROOT, check=True)
        if subprocess.run(['git', 'push', 'origin', 'HEAD:staging'], cwd=ROOT).returncode == 0:
            return
    raise RuntimeError('Unable to publish comparison')


def run(args):
    from faster_whisper import WhisperModel
    from huggingface_hub import HfApi, snapshot_download, hf_hub_download
    from radio_review_engines import ParakeetAdapter, adjacent_audio, target_text
    req = read(Path(args.request))
    experiment = req['experiment']
    if not re.fullmatch(r'[a-z0-9-]{1,90}', experiment):
        raise ValueError('Invalid experiment name')
    folder, data = load_archive(req['date'], req['talkgroup'], require_complete=False)
    targets = select_calls(data, req)
    neighbor_indices = sorted({j for i in targets for j in range(max(1, i-3), min(len(data['calls']), i+3)+1)})
    repo_id, convert = MODELS[args.model]
    revision = HfApi().model_info(repo_id).sha
    result = {'schema_version': 1, 'date': req['date'], 'talkgroup': req['talkgroup'],
              'experiment': experiment, 'model': repo_id, 'model_revision': revision,
              'created_at': dt.datetime.now(dt.timezone.utc).isoformat(), 'clips': {},
              'status': 'running', 'human_verified': False,
              'settings': {'engine': 'faster-whisper', 'beam_size': 5, 'temperature': 0,
                           'condition_on_previous_text': False, 'device': 'cpu', 'compute_type': 'int8'},
              'notes': 'Candidates only. Hints are hypotheses, not evidence. Original and filtered passes are unhinted.'}
    output = ROOT / 'transcription-work' / 'experiments' / experiment / (args.model + '.json')
    with tempfile.TemporaryDirectory(prefix='radio-audio-review-', dir=os.environ.get('RUNNER_TEMP')) as tmp:
        temporary = Path(tmp)
        client, bucket = client_and_bucket()
        audio = {}
        for i in neighbor_indices:
            c = data['calls'][i-1]
            if not stored_audio(c, folder.name) or c['audio_storage']['bucket'] != bucket:
                raise ValueError('Unverified R2 metadata')
            path = temporary / c['original_filename']
            path.write_bytes(read_verified(client, bucket, c['audio_storage']['key'], c['sha256'], c['size_bytes']))
            audio[i] = path
            result['clips'][str(i)] = {'index': i, 'filename': c['original_filename'], 'sha256': c['sha256'],
                'timestamp_mountain': c['timestamp_mountain'], 'target': i in targets, 'passes': []}
        if args.model == 'parakeet':
            local = hf_hub_download(repo_id, 'parakeet-tdt-0.6b-v2.nemo', revision=revision, cache_dir=args.model_dir)
        else:
            local = snapshot_download(repo_id, revision=revision, allow_patterns=['*.json', '*.txt', '*.bin', '*.safetensors'],
                                      cache_dir=args.model_dir)
        if convert:
            converted = Path(args.model_dir) / ('police-ct2-' + revision)
            if not (converted/'model.bin').exists():
                # This checkpoint stores a legacy list under extra_special_tokens.
                # Transformers 4.57 expects that key to be a named-token mapping.
                # Preserve the same tokens/IDs using additional_special_tokens instead.
                compatible = temporary / 'police-conversion-source'
                compatible.mkdir()
                for source in Path(local).iterdir():
                    if source.name != 'tokenizer_config.json':
                        (compatible / source.name).symlink_to(source.resolve())
                tokenizer_config = read(Path(local) / 'tokenizer_config.json')
                extra = tokenizer_config.get('extra_special_tokens')
                if isinstance(extra, list):
                    tokenizer_config.pop('extra_special_tokens')
                    tokenizer_config['additional_special_tokens'] = list(dict.fromkeys(
                        tokenizer_config.get('additional_special_tokens', []) + extra))
                write(compatible / 'tokenizer_config.json', tokenizer_config)
                result['tokenizer_compatibility'] = 'Legacy extra_special_tokens list mapped to additional_special_tokens; token vocabulary and model weights unchanged.'
                from ctranslate2.converters import TransformersConverter
                TransformersConverter(str(compatible), copy_files=['tokenizer.json', 'preprocessor_config.json']).convert(
                    str(converted), quantization='int8', force=True)
            local = str(converted)
        model = (ParakeetAdapter(local) if args.model == 'parakeet'
                 else WhisperModel(local, device='cpu', compute_type='int8', cpu_threads=4))
        if args.model == 'parakeet':
            result['settings'].update(engine='nemo', compute_type='float32', decoding='greedy_batch')
            result['notes'] += ' Parakeet uses no text prompts; beam size/temperature apply only to Whisper.'

        def transcribe(i, kind, source, prompt=None, target_window=None):
            segments, _ = model.transcribe(str(source), language='en', beam_size=5, temperature=0,
                condition_on_previous_text=False, vad_filter=False, initial_prompt=prompt, max_new_tokens=160, word_timestamps=target_window is not None)
            segments = list(segments)
            text = target_text(segments, target_window)
            result['clips'][str(i)]['passes'].append({'kind': kind, 'prompt': prompt, 'text': text, 'target_window': target_window,
                'segments': [{'start': s.start, 'end': s.end, 'text': s.text, 'avg_logprob': s.avg_logprob,
                              'no_speech_prob': s.no_speech_prob, 'compression_ratio': s.compression_ratio} for s in segments]})
            write(output, result)
            print(json.dumps({'clip': i, 'kind': kind, 'text': text}), flush=True)
            return text

        try:
            baseline = {i: transcribe(i, 'original', audio[i]) for i in neighbor_indices}
            for i in targets:
                filtered = temporary / f'{i}-filtered.wav'
                subprocess.run(['ffmpeg','-nostdin','-v','error','-y','-i',str(audio[i]),'-af',
                    'highpass=f=200,lowpass=f=3400,afftdn=nf=-25','-ar','16000','-ac','1',str(filtered)], check=True)
                transcribe(i, 'filtered', filtered)
                neighbors = [baseline[j] for j in neighbor_indices if j != i and abs(data['calls'][j-1]['epoch']-data['calls'][i-1]['epoch']) <= 120]
                if neighbors and args.model != 'parakeet':
                    transcribe(i, 'surrounding-context', audio[i], ' '.join(neighbors)[-600:])
                combined, window = adjacent_audio(audio, data, i, temporary)
                if combined:
                    transcribe(i, 'adjacent-audio', combined, target_window=window)
                for hint in ([] if args.model == 'parakeet' else req.get('hints', {}).get(str(i), [])):
                    if not isinstance(hint, str) or len(hint) > 600:
                        raise ValueError('Hint must be text up to 600 characters')
                    transcribe(i, 'candidate-hint', audio[i], hint)
            result['status'] = 'complete'
        except Exception as exc:
            result['status'] = 'failed'
            result['error'] = str(exc)
            raise
        finally:
            write(output, result)
            if args.publish:
                publish(output)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--request', required=True)
    parser.add_argument('--model', choices=MODELS, required=True)
    parser.add_argument('--model-dir', required=True)
    parser.add_argument('--publish', action='store_true')
    run(parser.parse_args())
