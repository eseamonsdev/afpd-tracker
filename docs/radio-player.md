# Shared radio player

The car-to-car archive, every excerpt, and Law 2 use:

- `src/_includes/radio-player.njk` for controls, transcript status and notes.
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
false setting keeps its transcripts hidden even if text exists. Law 2 adds its
enabled-date rules and coverage notes; it never loads the car-to-car association
data. The excerpt adapter retains
the server-selected clips, archive numbers, sections and order, and builds its
transcript download from that selection. Both 6001 views use the same dated
association renderer. Page content and recording data remain separate.

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
