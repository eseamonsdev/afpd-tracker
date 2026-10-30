# Officer association labels

The 6001 archive uses `public/records/openmhz/officer-associations.json` (schema 2) for both clip rows and the player. Entries are keyed by date and radio ID. Both Law 2 and car-to-car use this shared lookup. IDs are always bold; officer names have regular weight. Each label has an information button that opens on hover, focus or tap, with evidence dates and a link to the reference table. Escape, a second tap or an outside click dismisses it.

- **Confirmed this day:** a dated confirmation on the selected date from Law 2 or car-to-car. Confirmations do not carry to other dates.
- **Strong association:** the rendered Police Radio Resources table links the ID to one officer across at least two dates, but the selected date has no confirmed named exchange. The association can carry to a date with no car-to-car clips, including Law 2-only dates. This is not confirmation for the selected date.
- **Single-day association:** named evidence exists only on the selected date. These names are not extended to other dates.
- **ID only:** unresolved identity, uncertain name, possible contradiction on that date, or an unsupported date for a single-day association.

The October 27 review covers all 48 available 6001 archive days, September 9–October 26, 2026. The report in `findings/2026-10-27-radio-officer-label-review.json` records source blob hashes, coverage, candidate exchange decisions and held IDs. Screening examined name-led hails and the next different-radio transmission within 60 seconds/up to three clips, with surrounding context reviewed for potential mismatches. Mere mentions, responses on another officer's behalf and interleaved conversations do not establish identity conflicts. This is transcript screening, not audio verification or proof that every possible contradiction was found.

Names originate in the rendered resource table. Evidence dates and current-day supported exchanges use the response spreadsheet and the table's documented Choates and Ivan exchanges. Uncertain Choates/14590045 is excluded. Halladay/14590100 has known Heaton associations and is shown only on owner-confirmed September 24; it has no cross-date fallback. Single-day IDs are deliberately restricted to their supported date.

When correcting evidence, update the spreadsheet, resource table, dated labels and review report together. Known held dates remain ID-only. A fallback requires an existing strong association across multiple evidence dates, with no competing officer name for that radio ID. These labels describe radio associations; they do not independently identify the speaker in every clip. Transcript verified flags remain separate. Missing association data falls back to ID-only playback.

Owner listening confirmation can also establish **Confirmed this day** for a single supported date. The October 4 Manis / 14590314 identification uses this rule; possible similar-sounding names on other dates remain unconfirmed and receive no fallback label.

Owner Law 2 confirmations can create a dated entry even if the radio ID has
no 6001 clips that day. September 27, 2026 / 14580155 / 5J44 is an explicit
Brennan Cox confirmation under this rule; absence from 6001 is not a conflict.

The shared player derives a strong fallback from existing `strong` entries with
at least two evidence dates and a unique officer name. It applies even when
there is no dated entry. `withheld_dates` preserves the review report’s held IDs
and prevents the fallback on those dates. Single-day-only IDs do not acquire
a fallback. New 5J pairings alone never create an officer-name association; the
owner decides whether the evidence ties an officer to the radio ID.

Owner confirmation on October 29, 2026 identifies Tavo as David O. Guerra and
radio ID 14590023 as Guerra for October 27, 2026. The dated entry uses
**Confirmed this day**, based on the clips 128–129 hail/response and explicit
owner confirmation. It does not create a fallback on other dates or change
transcript verification flags.

Owner confirmation on October 30, 2026 identifies radio ID 14590088 as Joshua M.
Jensen for October 29, 2026. The shared player uses **Confirmed this day** for
that date only. Earlier radio-ID sightings do not create a cross-date fallback,
and transcript verification flags remain separate.
