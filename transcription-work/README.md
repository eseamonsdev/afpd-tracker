# Temporary radio transcription checkpoints

Eric authorized this text-only staging checkpoint folder on October 26, 2026.
It is outside the website input and is not linked from website navigation.
The repository is public, so checkpoint text is publicly readable in Git history.

`6001/YYYY-MM-DD/batch-NNN.json` holds the actual unfiltered, filtered, and
context-assisted model outputs, prompts, confidence indicators, source hashes,
and settings. No transcript redaction is added. These are unreviewed candidates,
not the authoritative transcript and not human-verified statements.

Each batch contains up to ten clips. `status.json` reports saved three-pass
coverage and whether reconciliation is still pending. Reruns restore matching
checkpoints and reject changed settings or source identities. Interrupted runs
attempt to commit partial text results as well.

Original audio is downloaded only from its verified R2 copy into the Actions
runner's temporary directory. Filtered WAVs stay there too. After each batch's
text commit, local audio is deleted. An always-run cleanup step also removes it
on failure. No audio or credentials are committed or uploaded as artifacts;
R2 originals are never deleted.

The daily ChatGPT transcription task reconciles every clip from these outputs
and surrounding conversation, publishes batches to the day's calls.json on
staging, preserves all user changes/verification/notes, and regenerates the
downloadable transcript. Automated entries remain unverified. It removes the
day's checkpoint directory only after all clips are reconciled, built, and
verified in staging. Removal does not erase Git history. On failure, saved
text stays available for resumption.
