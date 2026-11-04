"""Summarize an isolated comparison; never changes the daily R2 results."""
import json
from pathlib import Path
import numpy as np

folder = Path('voice-experiments/short-evidence/2026-09-28')
data = json.loads((folder / 'voices.json').read_text())
clips = {c['clip_number']: c for c in data['clips']}
assert set(clips) == {120, 192}
assert [str(v) for v in clips[120]['radio_ids']] == ['14590090']
assert [str(v) for v in clips[192]['radio_ids']] == ['14590066']
for clip in clips.values():
    if clip['status'] != 'embedded':
        raise RuntimeError(f"Clip {clip['clip_number']} did not produce an embedding")
x, y = (np.asarray(clips[n]['embedding']) for n in [120, 192])
score = float(np.dot(x, y) / (np.linalg.norm(x) * np.linalg.norm(y)))
result = {'date': data['date'], 'clip_numbers': [120, 192],
          'radio_ids': ['14590090', '14590066'],
          'speech_seconds': {str(n): clips[n]['speech_seconds'] for n in clips},
          'cosine_similarity': score, 'threshold': 0.70, 'passes_threshold': score >= 0.70,
          'basis': 'Existing owner-confirmed Samuel Canizalez evidence exchanges; not a new biometric identification',
          'model_revision': data['model_revision'], 'human_verified': False}
(folder / 'comparison.json').write_text(json.dumps(result, indent=2) + '\n')
lines = ['# Short cross-radio evidence test', '',
         f"September 28 clips 120 and 192: cosine similarity **{score:.6f}**.",
         f"Meets 0.70 cutoff: **{score >= 0.70}**.", '',
         f"Detected speech: clip 120 = {clips[120]['speech_seconds']}s; clip 192 = {clips[192]['speech_seconds']}s.", '',
         'Isolated 1-second-minimum experiment. Daily R2 results and general 3-second minimum are unchanged.']
(folder / 'report.md').write_text('\n'.join(lines) + '\n')
print(json.dumps(result, indent=2))
