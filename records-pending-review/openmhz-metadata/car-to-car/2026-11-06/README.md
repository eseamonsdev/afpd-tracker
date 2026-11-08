# Car-to-car metadata: November 6, 2026

OpenMHz talkgroup 6001 metadata — November 6, 2026

System: dcfems (Utah County Simulcast P25)
Talkgroup: 6001, American Fork PD Car to Car
Day: November 6 in America/Denver (MST, UTC−07:00)
UTC window: 2026-11-06 07:00:00 inclusive to 2026-11-07 07:00:00 exclusive.

343 distinct call IDs; 32 displayed radio IDs; no missing target-day rows in the combined browser inventories.
First call: 01:30:22 MST. Last call: 23:51:11 MST.
The immediately preceding call was November 5 at 22:27:53 MST.

Files:
- calls.json: normalized metadata, displayed radio IDs and offsets, patches, frequency, durations, audio URLs and per-call OpenMHz links.
- rows.json: combined browser row inventory, including separately preserved rows with the same timestamp and different durations.
- import-validation.json: counts, completeness checks, boundary evidence, and timestamp collisions.

Method: clicked individual OpenMHz rows, exported their rendered pages through the browser, and extracted the displayed metadata and links. Autoplay was disabled during the main collection. The browser displayed UTC; local_time converts each call to America/Denver. No API metadata requests or audio download workflow was used.

Precision: durations are whole seconds as displayed, not exact audio lengths. Frequencies were displayed to 0.001 MHz; freq converts those displayed values to Hz without restoring hidden precision. srcList preserves every radio ID and bracketed position shown in Call Info. Other fields not exposed by the UI, such as API-only flags, are not inferred.

Two calls have a displayed duration of zero seconds. Two distinct call IDs share timestamp 2026-11-06T17:22:40Z and the same audio URL/filename; both metadata records are preserved. This results in 342 unique audio URLs for 343 call IDs.

Project compatibility aliases (`id`, `media_url`, `call_link`, `radio_ids`, timestamps, and filenames) are derived only from the displayed browser metadata and links. Original collected fields are retained. No original API objects are claimed or fabricated.
