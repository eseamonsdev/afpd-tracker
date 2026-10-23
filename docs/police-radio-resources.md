# Police Radio Resources

The page is generated at `/police-radio-resources/` and linked from Police Radio,
the excerpts index, and each individual excerpt.

Edit `data/entities/pages/police-radio-resources.json` to update the practical
guide and its sources. `callSigns`, `language`, and `officers` contain the quick
lookups. `sources` is the single list of reference titles, URLs, descriptions,
publishers, formats, coverage, and notes. Each guide's `sourceIds` points to the
references it uses. Remove unused references instead of keeping a general
reading list. The Utah County source comes before the statewide source, placing
it on the left on wider screens and first on mobile. Use `download: true` for
downloadable files. The template escapes displayed text.

Officer entries are a selected snapshot of recurring associations in the
spreadsheet, with example counts and distinct response-day counts per ID. Keep
those values and the coverage date aligned with the workbook when updating
them. Unresolved names and single-day/conflicting IDs are not promoted to the
selected associations table. Links to officer profiles are roster candidates,
not confirmation of the speaker in every recording.

The expanded list includes surname-supported associations for Cox, Garcia,
Gonzalez, Hawkins, Mason, McClellan, Renter, and Richardson. Each added ID has
at least two examples across two days and no other name group in the selected
exchanges. Do not infer a full identity from vague first names such as Jake,
Sam, or Ron, or from an unconfirmed nickname. A lack of conflicts in the
selected examples is not proof that an ID was never used by anyone else.

The existing `afpd-radio-id-response-days.xlsx` spreadsheet is hosted in
`public/records/openmhz/`, alongside its OpenMHz source material. It is a
September 9–October 22, 2026 snapshot, not an automatically refreshed report.
Preserve its coverage and attribution qualifications when replacing it.

Run `make build` to regenerate the page, Police Radio link, and sitemap.
