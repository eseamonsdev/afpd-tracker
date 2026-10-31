"""CPU review adapters and timed adjacent-audio experiments."""
from pathlib import Path
from types import SimpleNamespace
import subprocess
import wave


def target_text(segments, window=None):
    if window is None:
        return ' '.join(s.text.strip() for s in segments).strip()
    start, end = window
    words = [w for s in segments for w in (getattr(s, 'words', None) or [])]
    if not words:
        return ''
    return ' '.join(w.word.strip() for w in words if start <= (w.start + w.end) / 2 < end).strip()


def adjacent_audio(audio, data, index, temporary):
    chosen = [j for j in (index-1, index, index+1) if j in audio
              and abs(data['calls'][j-1]['epoch'] - data['calls'][index-1]['epoch']) <= 120]
    if len(chosen) == 1:
        return None, None
    chunks, position, window = [], 0, None
    for j in chosen:
        wav = temporary / f'{j}-context-source.wav'
        if not wav.exists():
            subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-y', '-i', str(audio[j]),
                            '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', str(wav)], check=True)
        with wave.open(str(wav), 'rb') as f:
            assert f.getnchannels() == 1 and f.getsampwidth() == 2 and f.getframerate() == 16000
            frames = f.readframes(f.getnframes())
        duration = len(frames) / 32000
        if j == index:
            window = (position, position + duration)
        chunks.append(frames)
        chunks.append(bytes(6400))  # 0.2-second separator; source timestamps remain in metadata.
        position += duration + .2
    output = temporary / f'{index}-adjacent.wav'
    with wave.open(str(output), 'wb') as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(16000)
        f.writeframes(b''.join(chunks))
    return output, window


class ParakeetAdapter:
    def __init__(self, checkpoint):
        import torch
        import nemo.collections.asr as nemo_asr
        from omegaconf import OmegaConf
        torch.set_num_threads(4)
        self.model = nemo_asr.models.ASRModel.restore_from(checkpoint, map_location='cpu')
        self.model.eval()
        decoding = OmegaConf.create(OmegaConf.to_container(self.model.cfg.decoding, resolve=True))
        decoding.strategy = 'greedy_batch'
        OmegaConf.update(decoding, 'greedy.use_cuda_graph_decoder', False, force_add=True)
        self.model.change_decoding_strategy(decoding)

    def transcribe(self, source, **kwargs):
        wav = str(Path(source).with_suffix('.parakeet.wav'))
        subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-y', '-i', source,
                        '-ar', '16000', '-ac', '1', wav], check=True)
        output = self.model.transcribe([wav], batch_size=1, return_hypotheses=True, timestamps=True)
        if isinstance(output, tuple):
            output = output[0]
        hypothesis = output[0]
        timestamps = getattr(hypothesis, 'timestamp', {}) or {}
        words = [SimpleNamespace(word=w['word'], start=float(w['start']), end=float(w['end']))
                 for w in timestamps.get('word', [])]
        segment = SimpleNamespace(text=hypothesis.text, start=0,
            end=max((w.end for w in words), default=0), words=words,
            avg_logprob=None, no_speech_prob=None, compression_ratio=None)
        return [segment], None
