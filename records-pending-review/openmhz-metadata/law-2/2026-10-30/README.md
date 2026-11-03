# Law 2 metadata — October 30, 2026

Preserves all 1,680 calls exposed by the OpenMHz archive for talkgroup 5922 (`dcfems`) within October 30 in America/Denver (MDT, UTC−06:00). Includes 82 distinct reported radio IDs, including `0` if reported by the source.

Collection used the interactive archive with autoplay off and each row clicked individually. Every selected Call Info link was matched to its clicked row ID. No duplicate calls, empty radio panels, or missed rows were found before the preceding-day boundary. This describes the source-exposed archive, not complete radio reception. No audio archive downloads were started.

- `calls.json`: repository-compatible metadata, radio source entries and positions, exact Call Info panel text, media URLs, call links, and collection proof.
- `calls.csv`: normalized CSV export of the same 1,680 calls.

The browser displayed Pacific Time. The complete October 30 Mountain day corresponds to October 29 at 23:00 through October 30 at 23:00 in that display. The first included call is 00:00:04 MDT and the last is 23:59:30 MDT. Rows newer than the day were excluded, and the first older call was checked to verify the starting boundary.

Durations and frequencies retain the precision displayed by the UI. Epoch values come from the observed Download URL and were checked against the Call Info link timestamp. `srcList` reconstructs the radio IDs and bracketed positions displayed by the UI; unobserved API-only fields are omitted.
