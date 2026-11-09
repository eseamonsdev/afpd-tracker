# Police Radio Resources

The page at `/police-radio-resources/` provides agency call signs, radio
language, and one consolidated officer/radio-ID table. Edit the guide text
and reference links in `data/entities/pages/police-radio-resources.json`.
The template is `src/police-radio-resources.njk`.

## Consolidated officer evidence

`data/officer-association-evidence.json` is the source of officer associations,
including accepted named exchanges and dated Law 2 radio/call-sign pairings.
Directory-derived officer matches retain their call sign, confirmation date,
source attribution and date limits. Confirmation does not verify every transcript
or establish a permanent radio assignment.

`lib/build-officer-associations.js` generates the officer summary CSV, dated
evidence CSV and player labels. Two or three accepted evidence dates support
a possible association; four or more support a strong association. Dated
confirmations remain independently visible. Unreviewed candidates cannot
displace retained associations or increase their strength.

The resources page reads these CSVs and displays eligible officer associations
with expandable dated evidence. Visitors can follow the official directory link
without joining a separate radio/call-sign table to the officer table.

## Unresolved identities

Observations with review status `owner-requested-identity-review` appear in
the visible “Radio identities awaiting review” table. They remain unassigned,
do not confirm an officer, and do not count toward association strength.

The September 27 5J29/McOmie/Halladay case and the September 15/29
Garcia/Guerra radio history require owner review. Preserve existing dated
confirmations while recording the uncertainty. Resolve an observation only
after the owner decides the identity or corrects the underlying evidence.

## Historical sources and builds

The original `radio-agency-identifiers.json`, IDs-only CSV and workbook remain
available as historical source records. They are no longer rendered as a
separate section. The legacy `#radio-agency-ids` anchor leads to the consolidated
section.

The response-days workbook is a September 9–October 22, 2026 snapshot,
not an automatically refreshed report. Preserve its coverage and attribution.

Run `make build` to regenerate the page and other site outputs.
