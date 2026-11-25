# Shared radio player

The unified Car-to-Car/Law 2 archive and every excerpt use:

- `src/_includes/radio-player.njk` for controls, transcript status and notes.
- `src/_includes/radio-row.njk` for every clip row: a macro for excerpts and
  an HTML template cloned by both archive players.
- `public/css/police-radio.css` for player and row styling.
- `public/js/radio-player-core.js` for playback, prefetching, seeking, autoplay,
  controls/transcript toggles, row selection and association information.

Load the core before the page adapter, using deferred scripts in that order.
The archive and excerpt script paths remain small configuration adapters.
`police-radio-excerpt.css` contains only excerpt headings and range layout.
The old Law 2 stylesheet forwards to the shared stylesheet.

The archive controller handles dated manifests, query dates and cancellation.
It revalidates the date index and selected manifest when loading them. Both
archives use an explicit transcript setting from the date index when present,
falling back to the manifest for older indexes. Law 2 also requires actual
transcript text before exposing the shared toggle and download link. An explicit
false setting keeps transcript controls and downloads hidden in both archives,
even if text exists. Law 2 adds its
enabled-date rules and coverage notes. Both talkgroups use the same dated
radio-ID associations: names, strength labels and SVG information buttons.
Associations have no per-player enable switch: matching date, radio ID, name
and supported strength fields determine what appears. Unsupported dates and IDs
remain numeric; changing talkgroup does not extend an association to new dates. The excerpt adapter retains
the server-selected clips, archive numbers, sections and order, and builds its
transcript download from that selection. Both 6001 views use the same dated
association renderer. Archive exports and download links use `afpd-car-to-car-transcript-YYYY-MM-DD.txt`
for 6001 and `law-2-transcript-YYYY-MM-DD.txt` for 5922. Excerpt downloads use
`afpd-car-to-car-transcript-<excerpt-slug>.txt`.
Page content and recording data remain separate.

The `/police-radio/` archive uses the reusable recording-date calendar for both talkgroups:

- `src/_includes/radio-date-picker.njk` supplies `datePicker(prefix)` markup.
- `public/js/radio-date-picker.js` exposes
  `RadioDatePicker.create(container, { days, value, onChange })`.
- `public/css/radio-date-picker.css` scopes styles to that component.

The archive passes its own filtered date index, not a global date range. Only
years and months containing recordings are offered; individual missing days
are disabled. Browsing months does not select a day or interrupt playback.
The selected date is a compact button; activating it expands the calendar
directly below. Selecting a date (including the already selected date) closes
the calendar and returns focus to the button. Escape also closes and restores
focus; clicking or tabbing outside closes without moving focus back.
Selecting an available day uses the existing manifest loader and date URL.
Arrow keys move among available dates, Home/End move within a week, and
Page Up/Down browse available months. Enter/Space select the focused date.
Law 2 supplies only its enabled days; dates from the other talkgroup do not
become selectable. Excerpts have fixed dates and do not need a picker.
Focused calendar coverage lives in
`tests/radio-date-picker.test.js`.

The talkgroup selector offers AFPD Car to Car (6001) and Law 2 Northeast (5922).
Links use `/police-radio/?talkgroup=5922&date=YYYY-MM-DD` for Law 2, and
`talkgroup=6001` for Car-to-Car (the default when no valid group is specified).
Switching groups stops playback, cancels stale loads, updates the description,
and preserves the requested date even if the other group has no recordings.
Missing dates show an explicit empty-state message and no player or clip list;
the calendar still permits selecting only that group's available dates. The
same behavior applies to valid unavailable dates in shared URLs. With no valid
requested date, the group's newest enabled day is selected. Player controls
remain hidden while loading, after errors, and on days without playable audio.
The separate Law 2 HTML page has been removed without a redirect.

Add `&clips=50,51,52` to a dated talkgroup URL to show only those archive
clip numbers, in chronological order. Clip numbers keep their full-day values.
This view uses the talkgroup name as its heading and hides the descriptions,
date picker, talkgroup selector and progress summary. A "View full day" link
removes only the clips parameter. Playback, autoplay and transcript downloads
are limited to the selection. Invalid clip lists or dates show an error;
unavailable dates and clip numbers never fall back to another day's recordings.
The admin player continues to show the full day.

Playback controls use one persistent audio element on the deployed sites. The
existing alternate-host handoff/recovery path remains supported by the shared
engine. Playback, error recovery and cleanup must be changed in the core rather
than copied into adapters.

Whole-row clicks select a clip once. The native play button remains keyboard
accessible; information buttons, popup text and evidence links never select a
clip. Selection highlighting and hover styling cover the whole row.

Run `node --test tests/*.test.js` and `npm run build` after shared changes.
The three player suites load the core plus their own adapters. Shared regression
tests cover click bubbling, information controls, asset order and template IDs.

The owner-configured `904` prefix is displayed as Dispatch on every player,
while preserving the full numeric ID. This is a role label, not a person
association: no officer name, strength label or evidence popup is attached to
these IDs, even if a dated person entry exists. Other IDs retain the existing
dated association lookup.
