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
using Git history to preserve earlier wording; the initial-day finalizer deliberately refuses
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

This writes transcript.md and eligible calls.json transcript fields. Radio transcripts use one continuously corrected transcript.md;
do not create numbered radio transcript drafts. Git history preserves revisions.
No newly automated entry gets validated:true. Existing approved bracketed wording,
validation flags, corrections and unrelated metadata/audio must remain untouched.
Do not create or maintain separate review-backlog files; Eric reviews transcripts separately. Commit corrections so Git
history preserves earlier wording.

## Owner-directed transcript corrections

Use transcript.md as the single current police-radio transcript. Apply Eric's
exact approved corrections there, match the calls.json entry by audio
filename/epoch, update its transcript to the same wording, and set validated: true.
This flag records Eric's verification, not automated ASR review.
Preserve unrelated entries, metadata, and existing user edits. Commit changes;
use Git history to recover originals and compare revisions instead of maintaining
numbered radio drafts.

The Chief Paul interview is a separate workflow: preserve its original app
transcript and separately labeled revisions. Do not consolidate those files.

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
count, staging commit and failures. A queued run is not completion.
The daily automation stays enabled after ordinary successful runs.

## Full archive transcript review

On `excerpts` and `staging`, the owner authorized publishing all existing
`transcript.md` entries to their matching `calls.json` records, including
bracketed uncertainty and privacy markers. Match by original audio filename,
never by a guessed clip number. Preserve existing text and every validation flag.
Only `validated: true` means Verified; other available text is AI-generated and
Unverified. This publication does not validate entries or remove uncertainty annotations.
Each daily calls.json uses the boolean `enableTranscription`: true for days with
available transcripts, false for days without them. The full player shows its
transcript button only when this field is true. Within enabled days, missing,
blank, or non-string transcript fields display `[no transcript available]`.
Excerpt publication flags remain separate.

Days with audio but no saved transcript are not automatically transcribed by
this import. The ordinary daily transcription workflow above is unchanged.
