# Transcription helpers

Reference material for interpreting radio recordings and selecting short,
relevant hints for additional transcription runs. This folder is separate from
the audio archives, `calls.json`, and temporary ASR checkpoints.

## Files

- `reference-catalog.json`: starter names and terminology, grouped by category,
  with sources, spoken forms, observed recognition errors, and evidence limits.
  Includes parks, apartment communities, businesses, named streets, officer
  candidates, agency call signs, and radio terms. This is not an exhaustive
  directory or an AFPD protocol/codebook.
- `training-examples.json`: clips or segments personally selected by the owner
  because the words are especially clear. It starts empty. A human-verified
  transcript does not automatically qualify as a training example.
- `evaluation-cases.json`: actual comparisons of prompts and results. The first
  case documents both the successful Art Dye hint and the broader list that
  damaged “Cole.” Evaluation cases are separate from curated training examples.

## How to use the references

Keep independent, unhinted original and filtered passes as evidence. Review
their differences using the recording, nearby exchanges before and after it,
and only relevant catalog entries. For an unresolved span, rerun with a few
plausible candidates and save the exact hint and output. Compare the entire
result with the baselines, including words outside the targeted span. Then
reconcile using the audio rather than choosing the most confident-looking text.

For example, “Art Dye Park” corrected “an art die” in October 12 clip 7. A prompt
with ten local place names instead produced “an Art Dye call,” losing “Cole.”
An appropriate additional experiment could include both the place candidate
and the addressed first name. Its result still needs checking against the audio.

The full catalog is for the reconciler to consult; do not paste it into every
ASR prompt. Catalog membership alone does not establish that a name was spoken.
An addressed name and the person transmitting are often different people.
Radio-ID associations are supporting evidence and do not establish the speaker
in every clip. McKay and Makai remain separate candidates. A proposed nickname
or phonetic error is not an automatic substitution rule.

Preserve `transcript_original` permanently. Keep accepted current transcripts,
notes and verification flags unless a specific correction is authorized. New
machine outputs never become human-verified automatically. Retain uncertainty
where the available evidence does not resolve it.

## Adding a selected training example

Use the stable audio filename, date and talkgroup. Match the audio checksum
when preparing it. For a clear portion of a longer clip, include explicit start
and end seconds and the exact words in that portion. These fields are a
curation format; a model-specific preparation step is still required.

```json
{
  "talkgroup": 6001,
  "date": "YYYY-MM-DD",
  "filename": "dcfems-6001-EPOCH.m4a",
  "sha256": "verified audio SHA-256",
  "start_seconds": 0.0,
  "end_seconds": 2.5,
  "confirmed_text": "The exact words spoken in the selected segment.",
  "teaches": ["place-name"],
  "selected_by": "owner"
}
```

The curated segment text is intentional: it is a reviewed example and should
not silently change when the full clip's current transcript is edited. Original
and current full-clip transcripts remain in `calls.json`.

## Integration status

This folder is reference material. Creating it does not change production
transcription settings, automatically inject hints, retranscribe the archive,
or train a model. The current automated third pass still uses preceding text.
Pilot targeted hints against selected clips and clear examples before changing
the generic transcription pipeline. Log prompt choices and compare both fixes
and regressions; the first successful clip is not an accuracy benchmark.
