# Police radio excerpts

`src/police-radio-excerpt.njk` generates `/police-radio/excerpts/<slug>/` from
entities of type `police-radio-excerpt-page`. Each page's `excerpt` is a `$ref`
to a `police-radio-excerpt` entity. The descriptive `subtitle` supplies the public heading and listing title. Each
excerpt has an explicit, permanent `slug` for its URL. Keep slugs unique and
unchanged after publication, even when editing a title or reordering the list.
The number remains a unique internal identifier and sort key; never reuse it. The page entity lives under
`data/entities/pages/police-radio-excerpt-pages/`, and its content lives under
`data/entities/police-radio-excerpts/`.

An excerpt has `number`, `slug`, descriptive `subtitle`, optional `description`,
and `sections`.
Each section has an optional `title` and `description`, plus a `ranges` array:

```json
{
  "date": "2026-09-12",
  "first": "dcfems-6001-1789224430.m4a",
  "last": "dcfems-6001-1789224494.m4a"
}
```

Boundaries are inclusive original audio filenames, not mutable clip numbers.
Omit `last` for a single call. Multiple ranges and dates can appear in one
section; keep all selections chronological and nonoverlapping. The build
resolves ranges against the corresponding `calls.json`, checks audio exists,
and rejects missing boundaries, overlap, or reversed ordering. Clip numbers
displayed on the page are derived from the full day's chronological manifest.

Playback uses only `public/js/police-radio-excerpt.js`; it does not load or
modify the original radio script. Existing radio CSS is reused unchanged;
excerpt additions are scoped in `public/css/police-radio-excerpt.css`.
Autoplay starts off and, when enabled, follows all selected calls across
ranges and sections. A single audio element and next-clip byte prefetching
preserve the original player's single-element approach. Optional transcription
is scoped to excerpt pages.

Excerpt 1 contains September 12 morning calls 58–123, 130–163, and 172–230.
The gate and Corolla exchanges in the two gaps are excluded. Later overlapping
vehicle conversations remain for context; the possible afternoon follow-up is
not included. Section labels are organizational, not findings about legality.

Run `make build` and `node --test tests/police-radio-excerpt.test.js tests/police-radio.test.js`.
Commit the generated excerpt HTML and sitemap with the source changes.

After each successful full filesystem build, obsolete excerpt
`index.html` files are removed automatically. This also works when the last
excerpt page entity is removed. Other files, original recordings, and the full
radio archive are preserved. Failed, incremental, and JSON-only builds do not
run cleanup. Use `make build` after deleting or disabling page entities and
include generated HTML deletions in the commit (`git add -A` after reviewing
changes). Removing an excerpt's data entity also requires removing its page
entity reference; dangling references intentionally fail the build.

## Excerpt listing and additional selections

`/police-radio-excerpts/` lists the page entities in excerpt-number order.
Each entry shows the descriptive title and the sum of selected calls'
rounded `displayed_seconds` (approximate audio duration, without transmission
gaps). It uses the same range resolver as the player, so counts and durations
stay synchronized. Removing a page entity also removes its listing on build.

The September 12 starter selections were located using the draft transcript,
not a new listening review. No legal findings are added.

- #2: 489–566, 567–618, 620–671. Walmart observations, following a rideshare,
  and subsequent camera review. Clip 619 is an unrelated drink announcement;
  some other interspersed discussion remains for context.
- #3: 672–675, 681–683, 687–689, 695–710, 716, 719–734, 735–741.
  A woman looking for her car, including the reported reunion and a nearby
  clarification that another exchange concerns a different woman.
- #4: 877–901. Searching for a retail-theft/trespass suspect, including both
  anticipated resistance and discussion of avoiding a confrontation in-store.
- #5: 914–917. Reaction to someone photographing a traffic stop.

## Enable or disable an excerpt page

Set `"enabled": false` on a `police-radio-excerpt-page` entity to hide its page.
Omitting `enabled` or setting it to `true` publishes it; other values fail the
build. This setting belongs on the page entity, not the excerpt data entity.
Disabled pages remain in `entities.all` but are excluded from the page-type
collection used by pagination and the excerpts index. Their excerpt data and
stable numbers and slugs are retained. A successful full `make build` removes their old
excerpt HTML pages and sitemap entries. The excerpts index remains, showing
an empty-state message when all pages are disabled. Re-enable a page and run
`make build` to restore its original URL. Deploy generated changes, including
HTML deletions, for the setting to take effect on the hosted site.

## Optional transcription

Set `"enableTranscription": true` on the excerpt data entity to include a
Transcription: Off/On button in its player controls. It defaults to off; omit the
field or set it to false to omit the button and transcript data. Nonboolean
values fail the build. All published excerpts currently enable this feature.

When switched on, the panel shows the selected clip's `transcript` from its
daily `calls.json` and updates on manual selection and autoplay. Missing or
blank text displays `[no transcript available]`. The verification label reflects
`validated === true` in the daily manifest, and optional `note` text appears below
the transcript. Radio IDs come from `radio_ids` and `srcList`, with duplicate or
invalid IDs removed; clips without an ID show no ID text. Approved bracketed
annotations are displayed as written. Text is escaped in HTML and inserted as
plain text. The full-day radio page, script, and styles are unaffected.

## Stable URLs

Public headings and listing cards use descriptive titles without excerpt numbers.
The fixed slug is independent of the title, visibility, and listing order. Do not
regenerate it from a revised title or reuse a removed excerpt's slug or number.
Each build validates unique slugs/numbers across every excerpt data entity,
including disabled ones. Keep the excerpt data when disabling a page so its
identity is reserved.

Only descriptive URLs are published. Old numbered HTML pages and links are
removed; no redirects, aliases, or compatibility routes are maintained. Hiding
an excerpt removes its generated page and sitemap entry.

## Player parity with the full archive

Both players show extra controls by default. Hide Controls / Show Controls only
hides or reveals autoplay, the transcript toggle and transcript download; it
preserves playback and settings. Show Current Clip, the current clip label,
play/pause, progress and any open transcript stay visible. Notes use View Notes /
Hide Notes and start collapsed. Excerpt transcript downloads contain only the
selected excerpt calls. Date-specific officer labels and association evidence
use the same association data and interaction behavior as the archive. Information
buttons sit outside playback buttons so opening evidence does not play a clip.
