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
