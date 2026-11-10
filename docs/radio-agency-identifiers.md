# Historical radio/call-sign evidence

The former IDs-only table has been consolidated into the officer association
table on `/police-radio-resources/`. Its dated confirmations are retained in
`data/officer-association-evidence.json`, including the two unresolved identity
observations. The redundant IDs-only CSV has been removed.

`public/records/openmhz/radio-agency-identifiers.json` and the original workbook
remain historical snapshots. New officer evidence belongs in the consolidated
evidence source; do not regenerate the retired export or maintain a parallel
live association table. A dated radio/call-sign pairing does not establish a
permanent radio owner.


## Law 2 player labels

The Law 2 index derives AFPD fallback IDs from positive source IDs observed on
talkgroup 6001. This indicates observation on that channel, not proven ownership.
Explicit agency corrections in `data/radio-agency-corrections.json` override
that fallback. IDs beginning with `904` show Dispatch. Reviewed officer names
come from the shared officer association evidence and its generated labels.

For a callsign known only on one date, add `agencyRadioIds` to that date in
`data/law-2-radio-days.json`, for example:

```json
{
  "date": "2026-11-04",
  "enableDay": true,
  "enableTranscription": false,
  "agencyRadioIds": { "14750172": "7J20" }
}
```

Rebuilding carries these dated labels into the Law 2 index. They override officer
and AFPD fallback labels for that date only; global agency corrections apply on
other dates. Callsign labels use the numeric agency/unit format, such as 7J20.
