# Browser-to-GitHub audio handoff

The AI browser session discovers calls using the normal OpenMHz page. It commits
one JSON source manifest to `staging` at:

`records-pending-review/openmhz-manifests/YYYY-MM-DD.json`

That push triggers **Download OpenMHz manifests**, separate from the existing ZIP
importer and the headless-browser experiment. No manual action dispatch or ZIP is
needed. There is no cron schedule in this workflow.

The manifest must contain `date`, `timezone: "America/Denver"`, `system: "dcfems"`,
`talkgroup: 6001`, `coverage: "partial"`, a timezone-aware `collected_through_utc`,
`count`, and `calls`. Each call contains actual `id`, integer `epoch`,
`displayed_seconds`, `talkgroup: 6001`, `original_filename`, and `media_url`.
Optional source row text and radio metadata may be retained if actually observed.
See `scripts/download_openmhz_manifest.py` for exact validation requirements.

For the current-day test, resolve the day in America/Denver when the AI run starts
and use that start time as the collection cutoff. Do not call a midday archive a
complete day. Collect all source rows from midnight through cutoff before sending
the manifest. Browser discovery completeness must be checked by the AI session;
the downloader can validate only the supplied manifest and audio.

The workflow downloads sequentially with **at least two seconds after each
download attempt finishes before starting another**. Each clip is attempted once. Download or new-audio validation failures are logged
and skipped; the remaining clips continue. Invalid source manifests or existing-archive
integrity failures still stop the run. Audio URLs are restricted to the exact
OpenMHz media hosts and expected path. M4A signatures, ffprobe durations, and
checksums are validated before publishing changes.

Output folder:
`public/records/openmhz/openmhz-afpd-car-to-car-YYYY-MM-DD/`

Audio filenames: `dcfems-6001-<unix-seconds>.m4a`.
Car-to-Car metadata: `calls.json`, `validation.json`, `README.txt`.
Original source labels are retained in each call's `row` field; do not generate a separate `rows.json`.
Existing calls are preserved when extending a partial day. The workflow regenerates
`public/records/openmhz/index.json` using `lib/build-radio-index.js`, runs the radio
tests and site build, removes the processed source manifest, and commits to
`staging`. It never promotes production or force-pushes. It shares a concurrency
group with the ZIP importer to prevent simultaneous archive writes.

Every 100 source calls attempted, the workflow builds and commits the validated
audio, updated queue, and failure manifests to staging. Per-clip FETCH/OK/SKIP/FAILED
messages are flushed to the live log. The two-second gap follows each download attempt.
Failed clips are stored under `records-pending-review/openmhz-failures/` and are not
retried automatically. Copy a failure manifest into the active manifest queue only
when an independent retry is requested. Unexpected failures can lose the current
unfinished batch; earlier pushed checkpoints remain safe. A successful run means the supplied manifest was imported;
it does not establish that the current day has ended or contains no later calls.

Code-only changes no longer start downloads. Only pushes changing active manifests
or explicit workflow dispatch start the downloader. Parked manifests under
`records-pending-review/openmhz-paused/` are ignored.
