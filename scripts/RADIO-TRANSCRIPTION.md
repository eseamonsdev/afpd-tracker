# Daily AFPD transcription

For other dates, talkgroups or working branches, use the [generic radio actions](../docs/radio-workflows.md). Their defaults are talkgroup 6001 and staging; these daily-task instructions retain that selection.


## Transcription references

Consult [transcription helpers](../transcription-helpers/README.md) when reconciling names, places and radio terminology. The catalog supplies candidates and source references, not automatic substitutions. Keep unhinted passes and compare any targeted rerun against the audio; curated training examples are selected separately by the owner.

## Preserve original and current transcripts

Every published clip keeps both versions in `calls.json`: `transcript` is the
current wording; `transcript_original` is the immutable first published wording.
Use `scripts/transcript_versions.py::set_transcript` when publishing new text:
initial publication fills both fields, and subsequent corrections change only
`transcript`. Never replace an existing `transcript_original`, including during
retranscription. Preserve all human verification flags, notes and metadata.
For legacy clips without an original, recover history before correcting text;
copying an already corrected current transcript cannot recover its original.
Only human review may set `validated: true`; that flag applies to current text.

The 6001 historical backfill searches both `calls.json` and legacy
`transcript.md` / transcript draft files, including merge results, matching the
actual audio filename and checking available audio hashes. It chooses the first
nonempty retained version regardless of verification flags. These are earliest
published transcripts, not necessarily raw ASR passes. Per-clip source commits
and paths are recorded in `findings/6001-transcript-originals-audit.json`.
Run `python3 scripts/backfill_transcript_originals.py` to audit; add `--write`
to fill missing originals. Existing originals and current fields are preserved.

## Resumable Actions pipeline (owner update October 26, 2026)

The owner authorized `transcription-work/6001/YYYY-MM-DD/` as temporary,
public-repository, text-only checkpoints for the actual original, filtered,
and context-assisted outputs. This specific exception supersedes the older
instructions below that required all raw passes to stay private. Do not add
transcript redactions. Never commit audio, filtered WAVs, model files or secrets.
Use `.github/workflows/radio-transcribe.yml` and
`scripts/transcribe_radio_batches.py` for R2-only processing. Repository-level
R2 secrets/variables are injected into the Actions job. Download audio to the
runner temporary directory only, verify source hashes, commit text every ten
clips, and delete local audio after each saved batch and on failure. Resume
matching checkpoints rather than restarting completed passes.

The daily ChatGPT task hands off by updating
`records-pending-review/openmhz-transcription-request.json` with the resolved
previous Mountain date and a new request timestamp. Monitor Actions and its
checkpoint status. Read/reconcile EVERY clip's three real outputs, confidence,
uncertainty and relevant context. Commit reconciled transcripts to calls.json
in batches, preserving existing text, verified flags, notes and metadata.
No automated result becomes human-verified. This is preservation-aware batch
publication; do not invoke the initial-day finalizer over partially populated
calls.json. Source hashes checked by Actions must match current metadata.
Regenerate the downloadable transcript using the repository generator.
After the entire day is reconciled, built and verified in staging, remove only
that day's temporary checkpoint folder. Until then retain it to resume safely.
Never substitute blind voting or automatic raw-ASR publication for review.


Standardized October 16, 2026 with the owner's approval. Use staging, never main.
The previous America/Denver calendar day is the target, even for a manual run.
The daily ChatGPT task uses the previous Mountain day and requires its saved R2 archive. The scheduled ZIP importer has been retired; it never fetched new recordings.

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

Read repository instructions, this file and existing daily calls.json metadata.
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
transcript entries exist, preserve them, resume missing ASR, and reconcile changes
using Git history to preserve earlier wording; the initial-day finalizer deliberately refuses
to overwrite populated/validated call objects.

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

This writes every reconciled entry to its matching calls.json transcript field, including
bracketed uncertainty and privacy markers, and sets enableTranscription: true.
Every call must have nonempty text, even if the entire entry is an honest annotation
such as [unclear], [Unintelligible transmission], [static], or [No intelligible speech].
Do not invent spoken words for unintelligible audio or omit annotation-only entries.
calls.json is the only authoritative police-radio transcript. Do not create
transcript.md, numbered radio drafts, or separate review-backlog files.
Git history preserves earlier wording. No newly automated entry gets validated:true.
`make build` generates `transcript_YYYY_MM_DD.txt` beside each indexed day's
calls.json. These text files are derived exports, never editing sources.
They include Mountain Time, chronological clip numbers, radio IDs, verification
(`Verified: ✓` only for validated:true; `Verified: No` otherwise), and a
`Transcript:` label. Missing/blank/non-string text uses the player's exact
`[no transcript available]` fallback. Rebuild after calls.json corrections;
do not maintain the exports by hand or recreate transcript.md.
Existing approved wording, validation flags, corrections, and unrelated metadata/audio
must remain untouched. Uncertain entries remain unverified.

## Owner-directed transcript corrections

Apply Eric's exact approved corrections directly to calls.json, matching the
entry by original audio filename/epoch, and set validated: true.
This flag records Eric's verification, not automated ASR review.
Preserve unrelated entries, metadata, and existing user edits. Commit changes;
use Git history to recover originals and compare revisions.

The Chief Paul interview is a separate workflow: preserve its original app
transcript and separately labeled revisions. Do not consolidate those files.

## Publication and verification

Fetch staging immediately before publication. Reconcile concurrent changes;
never replace a stale calls.json over a newer copy. Verify unique filename and
chronological coverage, all three passes, audio hashes, JSON validity, preservation
of uncertainty annotations in unverified transcript fields, and preservation of metadata
and user edits. Publish only intended script/docs/calls.json changes.
Raw passes, prompts and unredacted intermediate outputs stay private. A GitHub
API tree/commit with an expected-head ref update is supported when git push is
unavailable. Verify the final staging ref and saved files after publication.

Report target date, clips processed, three-pass completion, player transcript
count, staging commit and failures. A queued run is not completion.
The daily automation stays enabled after ordinary successful runs.

## Full archive transcript review

The owner consolidated the daily police-radio transcripts into calls.json.
Publish reconciled text directly there, including bracketed uncertainty and
privacy markers. Match by original audio filename, never by a guessed clip number.
Preserve existing text and every validation flag.
Only validated: true means Verified; other available text is AI-generated and
Unverified. Publication does not validate entries or remove uncertainty annotations.
Each daily calls.json uses the boolean `enableTranscription`: true for days with
available transcripts, false for days without them. The full player shows its
transcript button only when this field is true. Within enabled days, missing,
blank, or non-string transcript fields display `[no transcript available]`.
Excerpt publication flags remain separate.

Days with audio but no saved transcript are not automatically transcribed by
this import. The ordinary daily transcription workflow above is unchanged.
