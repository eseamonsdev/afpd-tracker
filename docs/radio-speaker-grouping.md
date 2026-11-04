# Daily 6001 voice grouping

Workflow: **Group 6001 clips by suggested voice** (`radio-speakers.yml`).

Run against staging archives. Select one date, comma-separated dates, or `all` for
all available 6001 daily archives. Only one daily job runs at a time in each run.
Each date is processed independently. Labels do not identify people or match across days.
Results accumulate in the configured R2 bucket at `voice-recognition/6001/YYYY-MM-DD/voices.json`.
Each JSON includes normalized embeddings for later reuse, so the data does not
depend on retaining the downloadable artifact. Rerunning a day updates that day's
JSON at the same R2 key.

Defaults: ECAPA-TDNN, 3 seconds of Silero-detected speech, 0.70 cosine similarity
cutoff. The cutoff is an experimental starting value, not calibrated radio accuracy
or a probability. Complete-linkage clustering requires every pair within a group
to meet the cutoff, avoiding chains of weak matches. Singletons are unassigned.
Radio IDs are copied into reports and never used in clustering. Original clip
numbers are the 1-based positions in the unchanged calls.json, including gaps for
skipped clips. Audio marked unavailable is skipped without fetching placeholders.

## Start a run

Once this workflow is on the repository's default branch, Actions → Group 6001
clips by suggested voice → Run workflow provides the date/minimum/cutoff inputs.
It always reads staging archives and records the exact source commit.

While the workflow is only on staging, create or update
`records-pending-review/radio-speaker-request.json` on staging:

```json
{
  "days": ["2026-11-02"],
  "min_speech": 3,
  "threshold": 0.70,
  "request_id": "first-6001-test"
}
```

Use `"days": "all"` to process every available date. Change request_id to rerun
an otherwise identical request. Code-only pushes run tests without processing
audio. A run supports up to 256 daily archives; split larger selections.

## Results

Each daily Actions artifact (`radio-voices-6001-YYYY-MM-DD`) includes:

- `report.md`: suggested voices and original clip numbers.
- `clips.csv`: every clip, radio IDs, timestamps, speech duration, status, and
  minimum similarity to other members of its group.
- `voices.json`: full settings, source checksum, model revision, groups, metadata,
  skipped clips, errors, and explicit unverified status.
- `embeddings.npz`: normalized embeddings with original clip numbers.
- `progress.json`: extraction progress, useful if a job fails or times out.

Download artifacts within 90 days. Daily voices.json files remain in R2.
Reports are separate from the website and authoritative transcripts; no person
identifications or changes to source clip metadata are published.
Audio is read from R2 using existing secrets and verified against size and SHA-256.
Temporary audio is removed per clip. A clip error is recorded, other clips continue,
and the job ends failed with partial reports available. Model initialization or
credential failures may prevent a usable report.

## Local commands

Install ffmpeg, CPU torch/torchaudio 2.5.1, and
`pip install -r scripts/requirements-radio-speakers.txt`. Supply the same R2
environment settings as the existing radio workflows.

```bash
python scripts/group_radio_voices.py plan --days 2026-11-01,2026-11-02
python scripts/group_radio_voices.py plan --days all
python scripts/group_radio_voices.py run --day 2026-11-02 --min-speech 3 --threshold 0.70
```

Add `--publish` to save and readback-verify the daily JSON in R2.
The workflow has read-only GitHub contents permission and never commits embeddings to Git.
Planning needs no audio/model dependencies; running processes one day. Keep
clips below the minimum in the source archive so they can be revisited later.
