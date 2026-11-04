# OpenMHz scrolling metadata collector

Requires Node.js 20+ and Playwright. On a Raspberry Pi, use a supported 64-bit OS. From this directory, install the script dependencies:

```sh
npm ci
```

Start Chromium from a terminal on the Pi's desktop and keep it running:

```sh
chromium --remote-debugging-port=9222 --remote-debugging-address=127.0.0.1 \
  --user-data-dir="$HOME/.config/chromium-openmhz" \
  "https://openmhz.com/system/dcfems?filter-type=talkgroup&filter-code=6001"
```

In a second terminal, run the collector:

```sh
node collect-openmhz.cjs --date=2026-11-03 --talkgroup=6001
```

By default it connects to `http://127.0.0.1:9222`, reuses the existing browser profile and cookies, and opens its own collection tab. It closes that tab and disconnects when finished, leaving Chromium and your other tabs open. Routing and audio blocking apply only to the collection tab. The browser retains its existing timezone and settings; date boundaries and progress labels still use `--timezone` (America/Denver by default). Complete any browser verification manually when prompted; attached mode does not require `--headed`.

Use `--cdp-url=http://127.0.0.1:OTHER_PORT` to change the connection. A failed connection stops with instructions; it never silently launches a fresh browser.

To explicitly use the previous separate-browser behavior, add `--launch-browser`. Only that mode needs Playwright's downloaded Chromium (`npx playwright install --with-deps chromium`), or `--executable-path=/usr/bin/chromium` for a compatible installed browser. `--proxy` and `--ignore-https-errors` also require `--launch-browser`; attached mode uses the browser's existing settings. Do not combine `--launch-browser` with `--cdp-url`.

Collect multiple days sequentially:

```sh
node collect-openmhz.cjs --from=2026-10-27 --to=2026-10-29 --talkgroup=6001 --buffer-ms=500
```

The default timezone is America/Denver; midnight boundaries account for daylight saving time. Default system: dcfems. Other options: `--system=...`, `--timezone=...`, `--output=...`, `--headed`, `--max-requests=500`, `--max-scrolls=500`.

The browser opens the normal filtered page at midday and scrolls in both directions. It records the page's own JSON responses and retains every call field, including srcList radio IDs. Metadata requests are serialized with a 500 ms buffer after each response finishes. No audio is downloaded. Each day produces calls.json, browser-batches.json (full responses for auditing), and summary.json under openmhz-results/YYYY-MM-DD/.

A complete result requires observing calls before the starting midnight and at or after the following midnight. A stalled page, HTTP error, request failure, or request/scroll cap produces an incomplete result and a nonzero exit code, while retaining collected records. This conservative check may report incomplete for an empty day or a long silence extending past a boundary. Completeness means traversing the feed's pagination across the day; it cannot establish that the feed recorded every radio transmission.

Checkpointed output preserves work for inspection; rerunning currently recollects the date rather than resuming browser pagination. Do not run overlapping collectors against the same output directory.

Advanced environment options: `--proxy=http://host:port`. `--ignore-https-errors` is available only for environments with a known intercepting test proxy; leave it off for ordinary Pi use.

## Progress output

Logs work the same in a terminal and GitHub Actions (plain, append-only lines). A start line identifies the date, talkgroup, timezone and buffer. Direction changes and midnight boundaries are logged immediately. Every 10 seconds, a heartbeat shows:

- Current phase (loading or scrolling older/newer).
- Timestamps of the top and bottom visible call rows, in America/Denver by default, labeled MDT/MST as appropriate.
- Unique calls collected within the requested day and metadata requests sent.
- Seconds since the last response, plus a waiting notice after 20 seconds without new calls.
- Oldest and newest timestamps captured across all batches (including the boundary calls outside the day).

A final compact line reports COMPLETE or INCOMPLETE, count, requests, boundary checks and the output directory. Detailed JSON remains in summary.json rather than filling the console. There is no per-request or per-row console dump. Adjust the heartbeat with `--progress-seconds=10` (minimum 1).

## Sequential audit of additional Utah County groups

This collector accepts any valid P25 talkgroup ID; the group must actually be
carried by the selected feed. To audit the eleven previously screened groups:

```sh
npm run audit -- --dates=2026-10-22,2026-10-29 \
  --known-ids=../../public/records/openmhz/afpd-radio-ids.json \
  --output=../../openmhz-audit-results
```

Override the list with `--talkgroups=6002,6223,6224`. Jobs run sequentially and
write separate OUTPUT/TALKGROUP/DATE directories. `audit.json` counts matching
calls and distinct matching radio IDs and retains the exact call IDs. Every
source entry is compared, including secondary sources; zero/negative placeholders
are excluded. IDs observed on AFPD channels do not prove AFPD ownership.
Incomplete jobs are explicitly marked and cannot establish a full-day negative.
An environment/access failure stops the remaining jobs. The audit runner accepts
`--buffer-ms`, `--progress-seconds`, `--executable-path`, `--proxy`, `--cdp-url` and `--launch-browser` too.

Run `npm test` for browser attachment/cleanup, date/DST, invalid-calendar and multi-source exact-match tests.
The collector and audit runner do not modify site archives or trigger audio jobs.
