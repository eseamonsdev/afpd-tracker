# Officer association labels

Edit only `data/officer-association-evidence.json` for officer/radio evidence. `make build`, `npm run build`, and direct Eleventy builds regenerate:

- `public/records/openmhz/officer-associations.json`: shared labels for Law 2, car-to-car, and excerpts.
- `public/records/openmhz/afpd-radio-officer-ids.csv`: officer/radio summary, confirmed-day counts, status, dates, and evidence.
- `public/records/openmhz/officer-association-evidence.csv`: individual dated evidence records, with clip arrays serialized as semicolon-separated numbers.
- The Police Radio Resources table, rendered directly from the generated summary CSV.

The source contains an `officers` directory, `associations` records, and `withheld_dates`. Records use this shape:

```json
{
  "officer_id": "sammantha-j-halladay",
  "radio_id": "14590221",
  "date": "2026-10-30",
  "talkgroup": 6001,
  "clips": [],
  "evidence": "Owner confirms Halladay using this radio ID on this date.",
  "status": "confirmed",
  "confirmed_by": "Eric"
}
```

Populate `clips` with actual supporting clip numbers for that date and talkgroup. An empty array means the old evidence did not record specific clip numbers. Never infer clip numbers from radio sightings. `evidence` describes the basis for the identification. `supporting` records retain tentative observations for review without increasing confirmed-day counts. A transcript verification flag is separate from an officer identity confirmation.

Counts apply independently to each `(officer_id, radio_id)` pair:

- **Confirmed this day:** a confirmed record on the selected date, even with just one confirmed date overall.
- **Strong association:** four or more distinct confirmed dates.
- **Possible association:** exactly three distinct confirmed dates.
- One or two confirmed dates do not create an inferred name label on other dates.

Multiple clips, multiple records, or multiple talkgroups on the same date count as **one day**. Multiple officers may qualify independently for one radio ID. The player displays every qualifying officer with that officer's own strength, dates, and evidence control. A dated confirmation replaces only the same officer's inferred label. It does not suppress other qualifying officers. Holds suppress all person labels for that radio/date and exclude that date from the count.

The generated schema 3 lookup stores arrays per radio ID in both `days` and `associations`. The player reads these results without recalculating thresholds. The former `officer-confirmations.json` overrides and manually maintained table entries have been consolidated into the source. Historical review reports and the response workbook remain evidence provenance, not live generation inputs.

Migration preserved existing dated confirmations and owner-confirmed single-day identifications. It did not turn legacy fallback date lists into confirmed records. Tentative observations, missing clip references, and held dates remain explicit for further review. Names refer to radio associations; identifying the speaker in a particular recording still requires context.
