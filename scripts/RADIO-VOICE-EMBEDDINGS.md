# 6001 voice embeddings and comparisons

The **Embed 6001 voice clips** workflow extracts embeddings only. Select dates
(or `all`) and the minimum detected speech duration (default: two seconds).
Existing embeddings are reused without replacing vectors; only missing eligible
clips are processed. Extraction has no similarity threshold and creates no groups.
Its summary reports reused/new embeddings and errors.

Embeddings retain the existing model/revision path:
`voice-recognition/6001/DATE/embeddings/MODEL--REVISION/embeddings.json`.
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
