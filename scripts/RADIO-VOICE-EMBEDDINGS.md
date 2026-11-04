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

## Migration

`migrate_voice_model_layout.py` defaults to a dry run. It inventories the entire
old `voice-recognition/6001/` prefix, validates identities and destinations, and
copies all recognized objects. Embeddings and historical bundles remain byte
identical; comparison JSON changes only its embedding path. Snapshot hashes
must still match. Conflicts or unknown objects stop the migration.

The migration workflow runs with the same concurrency group as extraction and
comparison. `--apply --remove-old` removes old objects only after every
replacement has been read back and verified and sources are rechecked. Its
artifact contains per-object source/destination hashes and completion status.
No radio audio is moved, regenerated, or deleted. A completed migration is
safe to rerun; existing model-first objects are preserved.
