# Police radio excerpts

`src/police-radio-excerpt.njk` generates `/police-radio/excerpts/<number>/` from
entities of type `police-radio-excerpt-page`. Each page's `excerpt` is a `$ref`
to a `police-radio-excerpt` entity. The excerpt number supplies the title and URL;
keep it stable and unique. The page entity lives under
`data/entities/pages/police-radio-excerpt-pages/`, and its content lives under
`data/entities/police-radio-excerpts/`.

An excerpt has `number`, optional `subtitle` and `description`, and `sections`.
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
preserve the original player's single-element approach. No transcript UI is
included.

Excerpt 1 contains September 12 morning calls 58–123, 130–163, and 172–230.
The gate and Corolla exchanges in the two gaps are excluded. Later overlapping
vehicle conversations remain for context; the possible afternoon follow-up is
not included. Section labels are organizational, not findings about legality.

Run `make build` and `node --test tests/police-radio-excerpt.test.js tests/police-radio.test.js`.
Commit the generated excerpt HTML and sitemap with the source changes.

After each successful full filesystem build, obsolete numbered excerpt
`index.html` files are removed automatically. This also works when the last
excerpt page entity is removed. Other files, original recordings, and the full
radio archive are preserved. Failed, incremental, and JSON-only builds do not
run cleanup. Use `make build` after deleting or renumbering page entities and
include generated HTML deletions in the commit (`git add -A` after reviewing
changes). Removing an excerpt's data entity also requires removing its page
entity reference; dangling references intentionally fail the build.

## Excerpt listing and additional selections

`/police-radios-excerpts/` lists the page entities in excerpt-number order.
Each entry shows the number, optional subtitle, and the sum of selected calls'
rounded `displayed_seconds` (approximate audio duration, without transmission
gaps). It uses the same range resolver as the player, so counts and durations
stay synchronized. Removing a page entity also removes its listing on build.

The September 12 starter selections were located using the draft transcript,
not a new listening review. No transcript UI or legal findings are added.

- #2: 489–566, 567–618, 620–671. Walmart observations, following a rideshare,
  and subsequent camera review. Clip 619 is an unrelated drink announcement;
  some other interspersed discussion remains for context.
- #3: 672–675, 681–683, 687–689, 695–710, 716, 719–734, 735–741.
  A woman looking for her car, including the reported reunion and a nearby
  clarification that another exchange concerns a different woman.
- #4: 877–901. Searching for a retail-theft/trespass suspect, including both
  anticipated resistance and discussion of avoiding a confrontation in-store.
- #5: 914–917. Reaction to someone photographing a traffic stop.
