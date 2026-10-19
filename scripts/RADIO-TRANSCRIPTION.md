# Daily AFPD transcription

Standardized October 16, 2026 with the owner's approval. Use staging, never main.
The previous America/Denver calendar day is the target, even for a manual run.
The noon transcription follows the 7 a.m. archive import.

## Method and provenance

Use `radio-transcription-settings.json` and `transcribe_afpd_radio.py`.
Recovered historical choices are faster-whisper small.en, beam size 5,
temperature 0, condition_on_previous_text false, and three actual passes:
original audio, filtered audio, original audio with preceding transcript text.
Up to three preceding calls supply context. Do not concatenate neighboring audio.

The exact historical filter, context gap, precision and token cap were not saved.
The owner authorized explicit new defaults: mono 16 kHz filtered audio using
`highpass=f=200,lowpass=f=3400,afftdn=nf=-25`, CPU int8, a 60-second context window,
the last 600 characters of preceding original-pass text, and a duration-based
generation limit capped at 220 tokens to leave room for context. These are new
standard settings, not a claim of exact historical reproduction. Engine defaults
come from the pinned version. Cross-platform bitwise equality is not promised.

## Execution

Read repository instructions, this file and existing daily transcript headers.
Fetch latest staging. Ensure the target folder's calls.json and all saved audio
are present locally; sparse checkouts must include the target audio directory.
Never retrieve substitute audio from OpenMHz or silently change the target date.
An incomplete/missing archive must be reported accurately.

Install Python dependencies with `python -m pip install -r scripts/requirements-radio.txt`;
ffmpeg and ffprobe must be installed. Use private persistent project storage for
WORK_DIR and MODEL_DIR. Neither belongs in the public repository. If only ephemeral
storage is available, explicitly report that interrupted work will not survive
environment loss; persist expensive checkpoints privately before ending a run.

```
python scripts/transcribe_afpd_radio.py run --date YYYY-MM-DD --work-dir WORK_DIR --model-dir MODEL_DIR
```

Omit --date only when the actual execution date is the intended trigger date.
The script resumes completed passes after verifying settings and audio hashes.
`--clips 3,7,10` is calibration only; never use it to claim full-day completion.
An unchanged fully completed day should be verified and skipped. If only some
entries/documents exist, preserve them, resume missing ASR, and reconcile changes
under existing draft conventions; the initial-day finalizer deliberately refuses
to overwrite existing documents or populated/validated call objects.

## Reconciliation is required

After all three passes, the assistant must read EVERY clip's three outputs,
segment confidence/repetition indicators and nearby conversation. Do not publish
raw ASR automatically, use majority vote alone, or equate agreement with human
validation. This interpretive step is governed by these rules, not a claim that
all language judgment is deterministic. Listen where supported and useful;
otherwise retain ambiguity rather than claiming direct listening.

Keep uncertainty for disputed wording, names, codes, numbers, missing speech,
alternative readings and anything affecting meaning. Avoid supplying names from
memory or inventing speaker identities. Reject repetition, context leakage,
silence/static hallucinations and unsupported speech. Preserve privacy redactions.
If a name or other sensitive detail is already redacted, do not restore it from
the raw passes. Mark uncertain text with brackets and needs_review=true. All
token-cap affected clips must remain flagged pending review. Low confidence and
material cross-pass disagreement require scrutiny even when no ASR adds brackets.

Create private reviewed.json with exactly one entry per unique filename:

```json
{"date":"YYYY-MM-DD","settings_sha256":"from passes.json","entries":[{"filename":"dcfems-6001-EPOCH.m4a","text":"Reconciled text or [unclear].","needs_review":true}]}
```

Then establish the new day's artifacts:

```
python scripts/transcribe_afpd_radio.py finalize --date YYYY-MM-DD --passes WORK_DIR/YYYY-MM-DD/passes.json --reviewed REVIEWED_JSON
```

This writes transcript.md, transcript-review-backlog.md, an identical initial
transcript-drafts/transcript-draft-1.md, and eligible calls.json transcript fields.
No newly automated entry gets validated:true. Existing approved bracketed wording,
validation flags, corrections and unrelated metadata/audio must remain untouched.
Do not reintroduce reviewed entries into the backlog. Preserve superseded drafts
before subsequent edits, following the target day's existing conventions.

## Owner-directed transcript corrections

Keep transcript.md as the immutable original transcript as first saved. Apply
Eric's approved corrections to transcript-drafts/transcript-draft-1.md (or the
explicitly requested revision), not transcript.md. Draft one contains the full
transcript with corrections. For another correction to previously revised wording,
follow the day's draft-history rules; Eric may explicitly keep editorial or
annotation changes in the same draft without creating another revision.

Match the calls.json entry by its audio filename/epoch, update its transcript to
the exact approved wording, and set validated: true. This flag records Eric's
verification, not automated ASR review. Remove the corrected clip from
transcript-review-backlog.md if present, and have the backlog link to the active
corrected draft. Preserve unrelated entries, metadata, and existing user edits.

## Publication and verification

Fetch staging immediately before publication. Reconcile concurrent changes;
never replace a stale calls.json over a newer copy. Verify unique filename and
chronological coverage, all three passes, audio hashes, JSON validity, exclusion
of unresolved wording from newly populated fields, and preservation of metadata
and user edits. Publish only intended script/docs/transcript/calls.json changes.
Raw passes, prompts and unredacted intermediate outputs stay private. A GitHub
API tree/commit with an expected-head ref update is supported when git push is
unavailable. Verify the final staging ref and saved files after publication.

Report target date, clips processed, three-pass completion, player transcript
count, backlog count, staging commit and failures. A queued run is not completion.
The daily automation stays enabled after ordinary successful runs.
