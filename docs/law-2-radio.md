# Law 2 listening page

The `/law-2-radio/` review page retains its own page template and configuration
adapter (`src/law-2-radio.njk` and `public/js/law-2-radio.js`). Controls,
transcripts, row interaction, styles and playback use the shared player described
in `docs/radio-player.md`. Law 2 uses the same date-specific officer-name associations as 6001 for the same
radio IDs in the dcfems system, including strength labels and evidence popups.
IDs without a supported association for the selected date stay numeric.

## Enable dates and transcripts

Edit `data/law-2-radio-days.json` and build with `npm run build`:

```json
{
  "date": "2026-10-01",
  "enableDay": true,
  "enableTranscription": true
}
```

`enableDay` must be explicitly `true`. Missing entries, omitted flags and `false`
stay hidden. Enabled dates also require a nonempty manifest and audio for every
listed clip: either a nonempty local file or matching verified R2 storage
metadata. Missing audio suppresses the date rather than exposing broken clips.
This checks archived verification records, not live R2 availability on each build.

`enableTranscription` is independent of the recording manifest's flag. It is
effective only if transcript text exists. The toggle and download link stay hidden
when unavailable. Partial transcripts show a missing-text message for individual
clips. Downloads are generated from current manifest text with Law 2 headings.

The initial settings enable 27 dates with archived audio and transcripts on
September 10 and October 1–3, 2026. September 10 is a selected 110-clip trial.
Coverage notes preserve the distinction between archived calls and full reception.
New downloads are not automatically opted in.

`lib/build-law-2-radio-index.js` generates
`public/records/openmhz/law-2-index.json`; do not edit that output directly.
Disabling a date removes it from the player; it does not delete or restrict its
underlying recording files.

## Sitemap and search exclusions

The Law 2 page is linked on the site, included in the page sitemap, and permits
search indexing. The worker retains `X-Robots-Tag: noindex, nofollow` on raw
Law 2 archive responses, including audio and transcript downloads. Do not block
archive crawling in robots.txt: search engines need to read the noindex directive.

`data/discovery-exclusions.json` contains URL prefixes excluded from both page and
document sitemaps. The PDF/CSV scanner skips matching folders before recursing.
Add a URL prefix here to exempt another folder; matching is case-sensitive and
uses URL-encoded paths. Include a trailing slash when targeting a specific folder
rather than a family of names. Existing document listings are unaffected.

There is no internal site-search crawler today. A future one should use
`excludedFromDiscovery()` from `lib/discovery-exclusions.js` too. This setting does
not control local `rg`, third-party crawlers, or access permissions. The page and
files remain public to anyone with their URLs; search exclusion is not privacy.

## AFPD fallback label

The generated Law 2 index includes `afpdRadioIds`, derived on every build from
positive radio IDs in saved 6001 call manifests (`radio_ids` and `srcList`).
The shared renderer prioritizes Dispatch, then a supported dated person
association, then AFPD for an otherwise unlabeled ID in this set. AFPD has no
association-strength label or information icon. It indicates observation on
6001, not an independently verified speaker identity. No role or evidence is
copied into individual Law 2 call objects.

Explicit agency corrections in `data/radio-agency-corrections.json` override
6001 observation: 14580068 is 18J16, not AFPD (owner correction October 28,
2026; hearing date not supplied). The index excludes it from `afpdRadioIds`
and includes its identifier in `agencyRadioIds`. The player shows that identifier
in clip rows, accessible labels and the current clip. Original call metadata
and the observed-radio inventory remain intact.
