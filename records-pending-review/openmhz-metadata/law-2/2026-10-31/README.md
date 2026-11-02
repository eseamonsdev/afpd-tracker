# Law 2 metadata — October 31, 2026

Preserves all 1,632 calls exposed by the OpenMHz archive for talkgroup 5922 (`dcfems`) within October 31 in America/Denver (MDT, UTC−06:00). Includes 62 distinct reported radio IDs, including `0` as reported.

Collection used the interactive archive with autoplay off, clicking each row with a 500 ms pause after the click. Browser interaction and metadata verification add overhead beyond that pause. Each Call Info link was matched to the clicked row ID; no duplicate calls, empty radio panels, or missed rows were found before the preceding-day boundary. This describes the source-exposed archive, not complete radio reception. No audio files were downloaded or validated for this inventory.

- `calls.json`: repository-compatible metadata, radio source entries and positions, exact Call Info panel text, media URLs, call links, and collection proof.
- `calls.csv`: original normalized CSV export with the same 1,632 calls.

The browser displayed Pacific Time. The collection spans October 30 at 23:00 through October 31 at 23:00 in that display, corresponding to the complete October 31 Mountain day. The first included call is 00:00:28 MDT and the last is 23:59:29 MDT.

UI durations are whole displayed seconds; frequency precision is limited to the displayed value. Epoch values come from the observed Download URL and are checked against the Call Info link timestamp. The link's millisecond value is retained separately. `srcList` entries reconstruct only the radio IDs and bracketed positions shown by the UI; API-only source-entry IDs and other unobserved fields are not supplied.
