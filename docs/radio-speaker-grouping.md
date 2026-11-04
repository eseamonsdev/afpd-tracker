# Daily 6001 voice grouping

Workflow: **Group 6001 clips by suggested voice** (`radio-speakers.yml`).

Run against staging archives. Select one date, comma-separated dates, or `all` for
all available 6001 daily archives. Up to 15 daily jobs run concurrently in each run, subject to GitHub runner availability.
Each date is processed independently. Labels do not identify people or match across days.
Results accumulate separately by day, model, and exact model revision:

- `voice-recognition/6001/YYYY-MM-DD/embeddings/MODEL--REVISION/embeddings.json`
- `voice-recognition/6001/YYYY-MM-DD/comparisons/MODEL--REVISION/complete-linkage-cosine/threshold-0.70/groups.json`

The model folder includes the provider, model name, and full revision, for example
`speechbrain--spkrec-ecapa-voxceleb--0f99f2d0ebe89ac095bcc5903c4dd8f72b367286`.
Embeddings contain clip metadata, detected speech duration, extraction settings,
and normalized vectors, without grouping settings. Comparison files contain groups
and per-clip scores without duplicating vectors. They record the embeddings key
and SHA-256; readers must verify that checksum before combining the files.
A new threshold creates a separate comparison, reusing identical embeddings.
A rerun with changed extraction settings updates that model/revision's current
embeddings; older comparisons with a different embeddings checksum are stale.
Daily Actions artifacts retain the original combined voices.json for convenience.
Legacy R2 voices.json files are preserved as migration backups and are no longer
updated by the daily publisher.

Defaults: ECAPA-TDNN, 2 seconds of Silero-detected speech, 0.70 cosine similarity
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
  "min_speech": 2,
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
python scripts/group_radio_voices.py run --day 2026-11-02 --min-speech 2 --threshold 0.70
```

Add `--publish` to save and readback-verify the daily JSON in R2.
The workflow has read-only GitHub contents permission and never commits embeddings to Git.
Planning needs no audio/model dependencies; running processes one day. Keep
clips below the minimum in the source archive so they can be revisited later.

## Reorganize existing R2 results

Run `python scripts/reorganize_voice_storage.py` for a read-only dry run.
Add `--apply` to copy the legacy daily JSON into the new layout and verify all
destination sizes and SHA-256 hashes by reading them back. The migration never
deletes or overwrites legacy objects. Identical destinations are verified and
skipped; different existing destinations stop that day with an error.

The one-time migration workflow and its request file were removed after the
55-day migration completed. The script remains available for manual maintenance
and supplies the storage helpers used by future daily voice runs.

Migration reorganizes existing results only; it does not process audio or recover
previously overwritten runs. Historical 3-second extractions remain marked as
3-second extractions even though the current default is 2 seconds.
