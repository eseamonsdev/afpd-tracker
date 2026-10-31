# Officer association evidence and labels

Edit `data/officer-association-evidence.json` to review or correct an association. `make build`, `npm run build`, and direct Eleventy builds regenerate:

- `public/records/openmhz/officer-associations.json`: shared labels for Law 2, car-to-car, and excerpts.
- `public/records/openmhz/afpd-radio-officer-ids.csv`: full names, radio IDs, distinct evidence-day counts, strengths, dates, evidence descriptions, and previously confirmed day counts.
- `public/records/openmhz/officer-association-evidence.csv`: dated source records, clip numbers, original names heard, original assessments, alternative candidates, and review status.
- The Police Radio Resources tables, rendered from the generated CSVs.

## Current unfiltered review

Eric requested that all observations from both versions remain available without deciding which are valid. The source sets `review_mode: "include-all"`. Every `confirmed` or `supporting` record counts by distinct date. Repeated clips, repeated source records, and multiple talkgroups on the same date count as one day per officer/radio pair. `rejected` records remain documented and do not count.

The source combines all 366 workbook exchanges, all 20 workbook exceptions, all 63 historical candidate reviews, all 136 records from the first migration, original table notes, old evidence-date lists, and the October 30 Halladay confirmation. It preserves duplicate observations from distinct sources, conflicts, original uncertainty, missing clip references, and historical hold decisions. Holds are review evidence in this mode and do not suppress names or dates.

Full roster names are the primary labels. Original first names, surnames, nicknames and transcription uncertainty remain in `name_heard`, `evidence`, and provenance. Where a full identity is unknown, the name remains explicitly unresolved.

## Record format

```json
{
  "record_id": "stable-source-record-id",
  "officer_id": "sammantha-j-halladay",
  "radio_id": "14590221",
  "date": "2026-10-30",
  "talkgroup": 6001,
  "clips": [],
  "evidence": "Description of the exchange or other evidence.",
  "status": "supporting",
  "confirmed_by": null,
  "review_status": "pending"
}
```

`clips` contains recorded clip numbers for that date and talkgroup. An empty array means the prior source did not record specific clip numbers. `confirmed_by` is not filled by the importer. Existing confirmations remain intact; importing a tentative observation does not create a new owner approval or alter transcript verification.

Multiple candidates receive separate records with the same `candidate_group_id`, date, clips and `candidate_officer_ids`. Each candidate counts dates independently. The original ambiguity remains in the evidence and the evidence CSV's “Other candidates” column. The importer does not pick a winner. Examples include Mckay A. Valadez / Philip E. Valadez, Sammantha J. Halladay / Samuel Canizalez, and Philip E. Valadez / Philip W. S. Craig.

Observations without an established name/radio pairing are retained in `observations`, exported to the evidence CSV, and shown in the expandable observations table. They are not silently assigned an identity or radio.

## Generated labels

- **Confirmed this day:** a prior confirmed identification exists for the selected date.
- **Association this day:** imported evidence exists on that date and awaits review.
- **Possible association:** exactly three distinct included evidence dates.
- **Strong association:** four or more distinct included evidence dates.
- One or two dates do not extend a name onto other dates.

Several officers may qualify for one radio. All qualifying names are displayed independently. A dated entry replaces only the same officer's inferred label. The information control includes the date, clip numbers, original name heard and evidence. The source's `review_status` makes the unreviewed import explicit.

Generated schema 3 stores arrays per radio ID in both `days` and `associations`. The player reads these results without recalculating thresholds. Without `review_mode: "include-all"`, only `confirmed` records count and `withheld_dates` again suppress labels and counts. Keep the current mode until Eric decides how his reviewed corrections should be applied.

## Import provenance

`python scripts/import_officer_association_evidence.py` reproduces the initial union from fixed Git snapshots. It is not a build step and must not be rerun over Eric's later corrections. The source stores each record's provenance and the original findings, resource entries and review explanations. The workbook and historical review report remain unchanged.

## Listening review page

`https://media.afpd-accountability.com/officer-association-review.html` is the standalone, noindex listening page stored in `afpd-public-media` under `officer-association-review.html`. `make build` regenerates its tracked HTML, and the existing recording-status publisher rebuilds and uploads it from staging whenever evidence, review source/assets, or call manifests change. Publication verifies the R2 read-back bytes and the public HTML response.

The page groups full candidate names alphabetically, dates chronologically, and the selected 6001 clip numbers chronologically within each date. It includes only non-rejected association records with actual 6001 clip references. Dates with no clip numbers and Law 2 records are omitted. A repeated clip appears once within a person's date, while shared evidence appears under every relevant candidate. Missing manifest references or unavailable audio fail the build instead of silently omitting evidence.

Each date has native seeking/volume controls, previous/next, playback speed, optional autoplay within that date, transcripts, original evidence notes and direct recording/archive links. Only one date plays at a time. Audio is not preloaded, and the self-contained page does not fetch association data, stylesheets or scripts from another host. Referenced recordings use their verified R2 object keys, with the existing archive URL as a fallback for local historical audio.
