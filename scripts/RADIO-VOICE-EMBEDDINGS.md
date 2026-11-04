# 6001 voice embeddings and comparisons

The **Embed 6001 voice clips** workflow extracts embeddings only. Select dates
(or `all`) and the minimum detected speech duration (default: two seconds).
Existing embeddings are reused without replacing vectors; only missing eligible
clips are processed. Extraction has no similarity threshold and creates no groups.
Its summary reports reused/new embeddings and errors.

R2 is organized by model/revision, then talkgroup:

```text
voice-recognition/MODEL--REVISION/6001/
  embeddings/DATE/embeddings.json
  comparisons/
    complete-linkage-cosine/threshold-0.70/DATE/groups.json
    profile-matching/
      test-runs/RUN-ID/results.json
      day-runs/DATE/RUN-ID/results.json
  archives/legacy/DATE/voices.json
```

The two profile-matching prefixes are reserved with empty `.keep` markers.
Test runs can select clips across dates; day runs select clips from one day.
Profile matching itself is not implemented yet. Officer reference lists remain
in `data/voice-profiles/` and can span multiple dates.
Historical combined voice bundles are retained byte for byte under `archives/legacy/`.
These are preserved snapshots, not active extraction or comparison inputs.
Local Actions artifacts may use a temporary day-first folder; R2 readers and
writers use the model-first paths above.
Existing comparisons remain saved; embedding updates do not refresh them.
Comparisons record the checksum of the embedding snapshot they used.

Run **Compare saved 6001 voice embeddings** explicitly when ready to compare.
Supply a date, the exact model revision from its embeddings folder, and a cosine
similarity cutoff (default: 0.70). It reads saved embeddings without downloading
radio audio or loading the speaker model, and writes only the comparison folder
for that model, revision, and threshold. This workflow is manual only.

For a downloaded embeddings file, comparison can also run locally:

```sh
python scripts/group_radio_voices.py compare --embeddings embeddings.json --threshold 0.70 --output comparison
```

Add `--publish` to save the comparison to the configured R2 bucket. Group labels
are experimental and local to that date; they do not confirm a person's identity.
The dedicated short-evidence experiment still explicitly runs extraction followed
by comparison, and never publishes subset embeddings over daily archives.

## Completed migration

All 55 days were moved into the model-first layout on November 4, 2026.
The 165 original objects were copied and verified before their old paths were
removed. Embedding bytes were preserved, and comparison references were updated.
The temporary migration script, workflow, request, and migration-only tests have
been removed. Shared storage helpers remain in `reorganize_voice_storage.py`.

[Completed migration and audit](https://github.com/eseamonsdev/afpd-tracker/actions/runs/41873405847)
