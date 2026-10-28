# Shared radio player

The car-to-car archive, every excerpt, and Law 2 use:

- `src/_includes/radio-player.njk` for controls, transcript status and notes.
- `src/_includes/radio-row.njk` for every clip row: a macro for excerpts and
  an HTML template cloned by both archive players.
- `public/css/police-radio.css` for player and row styling.
- `public/js/radio-player-core.js` for playback, prefetching, seeking, autoplay,
  controls/transcript toggles, row selection and association information.

Load the core before the page adapter, using deferred scripts in that order.
The three original script paths remain small configuration adapters.
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
