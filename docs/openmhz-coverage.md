# Radio archive coverage metadata

Coverage describes the source inventory, independently of audio validation. It is
metadata only; the radio player continues to display times from Unix epochs.

- `complete`: the collector verified the entire Mountain calendar day's source
  inventory. `collected_through_utc` is the following local midnight in UTC (the
  exclusive end of the day), not the time of the last call.
- `partial`: the inventory covers only part of the day. A timezone-aware cutoff
  within that Mountain day is required.
- `unknown`: full-day coverage is not established. Missing or null coverage is
  treated as unknown; the cutoff may be null when it was not recorded.

All calls must start within the target `America/Denver` calendar day. Complete
coverage is rejected while that day is still in progress. Midnight boundaries
follow daylight saving time, so a calendar day can span 23, 24, or 25 hours.

Successful imports merge calls, validate existing audio before skipping it, and
write refreshed metadata only after every requested download validates. An
incoming complete inventory upgrades partial or unknown coverage; a subsequent
partial rerun does not downgrade an already complete archive. Older archives may
lack call IDs; matching audio filenames can be enriched with incoming IDs without
downloading their audio again.

The October 12, 2026 backfill uses existing validation reports and README notes,
not a new OpenMHz inventory. September 9–11 and September 14–October 4 have recorded
day-boundary verification and are marked complete. September 12–13 are unknown:
their saved files do not establish independent full-day source completeness.
October 12 retains its recorded partial coverage. Existing per-call records and
audio-validation evidence are preserved; a metadata-only validation file does not
claim that new audio validation was performed.

September 12–13 were subsequently checked against the live OpenMHz archive UI on
October 12, 2026. Both full-day source inventories exactly match the saved call
IDs and epochs: 992 source entries / 991 unique audio files on September 12, and
359 source entries / 359 unique audio files on September 13. Both are now marked
complete. Each folder's `source-verification.json` records comparison hashes and
calls observed on both sides of the day boundaries. No audio was missing.

## Current metadata format

All Car-to-Car `calls.json` and `validation.json` files use `schema_version: 1`
and share date, timezone, system, talkgroup, unique-audio count, source-call count,
coverage, and collection cutoff fields. Call records include the original source
ID, Unix epoch, normalized UTC/Mountain timestamps, original filename, source URL
and label, actual size, SHA-256, measured audio duration, and whether the measured
duration agrees with the source label within one second. Additional historical
radio metadata and validation evidence remain available.

`rows.json` follows the chronological unique-audio order in `calls.json`. When
standardization changes an older source-row inventory, its original contents are
preserved in `legacy-rows.json`. Alternate source entries for the same audio file
remain in `duplicate_source_calls`; source-call count can exceed audio count.
README files use the same format, with earlier notes preserved in `legacy-README.txt`.

Historical downloaded/skipped counts and minimum download pauses are null when
they were not recorded. Local metadata verification does not invent downloads or
timing history. Existing recorded durations are reused only alongside matching
audio checksums; missing measurements are filled using ffprobe. The September 24
clip `dcfems-6001-1790298258.m4a` has a 9-second source label but a measured duration
of 1.408 seconds. Its unchanged audio remains valid and the discrepancy is recorded
in the call and validation metadata. Newly downloaded audio still must satisfy
the normal duration check.

Run `python3 scripts/normalize_openmhz_metadata.py` to standardize existing
Car-to-Car metadata, or add `--check` to verify it without writing. The direct
downloader checks this format before committing; the ZIP importer remains
available and standardizes Car-to-Car metadata after extraction. Both workflows
share the same archive writer lock. Coverage stays off the webpage.

The AI task runs daily at 7:00 AM in `America/Denver`, starting October 13, 2026.
It resolves the previous local calendar day when the run starts. The first run
targets October 12 and extends its partial archive, skipping validated existing
audio and refreshing the metadata after successful collection and validation.
