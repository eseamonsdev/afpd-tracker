# Officer association evidence and labels

Edit `data/officer-association-evidence.json` to review or correct an association. `make build`, `npm run build`, and direct Eleventy builds regenerate:

- `public/records/openmhz/officer-associations.json`: shared labels for Law 2, car-to-car, and excerpts.
- `public/records/openmhz/afpd-radio-officer-ids.csv`: full names, radio IDs, distinct evidence-day counts, strengths, dates, evidence descriptions, and previously confirmed day counts.
- `public/records/openmhz/officer-association-evidence.csv`: dated source records, clip numbers, original names heard, original assessments, alternative candidates, and review status.
- The Police Radio Resources tables, rendered from the generated CSVs.

## Protected production baseline

Eric explicitly requires every strong association and every dated entry marked confirmed in production to remain across all days. `data/production-officer-association-baseline.json` freezes the production response, retaining only those protected entries, its URL, capture time, and original response SHA-256. The captured baseline contains 29 strong pairs and 113 dated confirmed entries. Builds never refresh this snapshot from the network.

`lib/production-association-baseline.js` supplies protected evidence before compilation. Existing strong labels, evidence dates, and confirmed dates cannot be removed or demoted by later candidate imports, evidence filtering, or historical holds that production did not apply. Evidence dates may gain explicitly accepted additions. A new candidate cannot join a protected confirmed radio/date with a conflicting identity. The original verifier attribution is preserved: retaining production's confirmed label does not newly assert Eric personally verified it.

The production baseline includes its legacy unresolved strong label; the general exclusion of newly inferred unresolved identities does not delete that existing label. Pending production possibilities and observed-only dates are not automatically imported.

## Reviewed evidence only

The unfiltered review mode has been removed. The compiler rejects the retired `review_mode` setting instead of interpreting it. Transcription, AI suggestions, repeated hails, and repeated dates cannot approve an identity.

`association_reviewed: true` accepts a specific evidence record for association counting. Existing individually accepted pre-union records, selected evidence behind the accepted production baseline, and Eric's evidence selections were retained with `association_review_basis`. This metadata does not claim Eric personally confirmed every identity. Other source rows stay unreviewed and do not contribute to strength, even if an older AI import called their status confirmed.

Every original source row, uncertainty, candidate, and provenance remains available in canonical evidence. The CSVs retain pending and rejected candidates, while player and profile labels use accepted evidence. Repeated records, clips, and talkgroups count once per date for an officer/radio pair.

Profile-header names, including middle initials, are used for labels. Full middle names remain in profile details and original evidence wording.

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

## Dated confirmation and general strength

A source record with `status: "confirmed"` and `confirmed_by: "Eric"` is an owner-confirmed instance on its recorded date. It remains eligible even if an older AI context exclusion, historical hold, or evidence selection filter disagrees. In the player, a confirmed date replaces all general identities for that radio on that date, including another officer's strong association. The usual general identity returns on other dates. One confirmed date is not automatically converted into a permanent pair confirmation.

General strength counts distinct dates with explicitly accepted evidence:

- **Possible association:** two or three accepted dates.
- **Strong association:** four or more accepted dates.
- **Confirmed this day:** owner confirmation for the selected date.
- A single accepted date does not extend a name across dates.

Strong and possible identities are never mixed for one radio. When accepted strong associations exist, possible alternatives remain CSV-only unless they have a date-specific owner confirmation. Otherwise two accepted possible associations can coexist. Unreviewed additions cannot change an established strength, introduce another name, or replace a confirmed instance. `display_policy.accepted_general_pairs` retains the accepted general mappings: even newly accepted evidence for a competing general pair cannot replace those mappings until that pair is explicitly accepted too. Non-conflicting new pairs remain eligible after individual evidence review. Dated owner confirmations are independent of this general-pair guard.

`association_confirmations["officer-id/radio-id"].confirmed` is reserved for a separately explicit general pair approval. Existing day confirmations are not used to seed that general approval. A general approval, if explicitly supplied, still yields to the selected date's confirmed identity.

Generated schema 4 stores owner-confirmed date entries in `days`, selected general strengths in `associations`, and eligible mappings in `profiles`. The player applies the same date-first, strong-before-possible precedence. Production’s `withheld_dates` is retained. Older holds that production did not apply cannot hide the protected labels; dated confirmations still take priority over general associations.

The evidence CSV includes Evidence accepted and Acceptance basis, separately from personal confirmation and display eligibility. The importer for personal evidence selections marks only the selected records accepted; AI report imports do not.

Saved personal confirmations on the public-media review page survive subsequent AI context exclusions and missing clips in a later payload. Explicit user unchecks/removals still revoke their associated saved confirmation. User-requested former-employee exclusions remain enforced. Transcript corrections remain separate from identity confirmation.

See `findings/2026-11-01-officer-association-display-audit.md` for the duplicate inventory and source tracing.

## Import provenance

`python scripts/import_officer_association_evidence.py` reproduces the initial union from fixed Git snapshots. It is not a build step and must not be rerun over Eric's later corrections. The source stores each record's provenance and the original findings, resource entries and review explanations. The workbook and historical review report remain unchanged.

## Listening review page

`https://media.afpd-accountability.com/officer-association-review.html` is the standalone, noindex listening page stored in `afpd-public-media` under `officer-association-review.html`. `make build` regenerates its tracked HTML, and the existing recording-status publisher rebuilds and uploads it from staging whenever evidence, review source/assets, or call manifests change. Publication verifies the R2 read-back bytes and checks the public HTML response when accessible. A runner-specific public HTTP 403 is reported separately without failing a successful R2 upload or claiming public verification; use a browser to verify that case.

The page groups full candidate names alphabetically, dates chronologically, and the selected 6001 clip numbers chronologically within each date. It includes only non-rejected association records with actual 6001 clip references. Dates with no clip numbers and Law 2 records are omitted. A repeated clip appears once within a person's date, while shared evidence appears under every relevant candidate. Missing manifest references or unavailable audio fail the build instead of silently omitting evidence.

Each date has native seeking/volume controls, previous/next, playback speed, optional autoplay within that date, transcripts, original evidence notes and direct recording/archive links. Only one date plays at a time. Audio is not preloaded, and the self-contained page does not fetch association data, stylesheets or scripts from another host. Referenced recordings use their verified R2 object keys, with the existing archive URL as a fallback for local historical audio.

## Sam identity corrections (November 1, 2026)

The pre-October-31 CSV records Eric’s listening identifications of Halladay on
14590067 (October 7–8) and 14590100 (September 24), and Canizalez on 14590090
and 14590066 (September 28) and 14590268 (October 7). The missing confirmer
attributions on Halladay’s October 7–8 records are restored from those notes.
The October 30 Halladay confirmation on 14590221 also remains intact.

For this pair, shared first-name candidates are unassigned observations, not
independent evidence dates for both officers. The shared filter applies this
rule to the listening page, CSVs and labels, including later imports. A named
owner confirmation overrides competing candidates only for overlapping clips
on the same date, talkgroup and (for association records) radio. It never
assigns every recording from a radio to one person. September 20, October 13
and October 17 on 14590221 remain unassigned pending listening identification.
Original imported records remain in the source for provenance.
