# Police Radio Resources

The page is generated at `/police-radio-resources/` and linked from Police Radio,
the excerpts index, and each individual excerpt.

Edit `data/entities/pages/police-radio-resources.json` to change the page title,
introduction, section order, source order, or any source title, URL, description,
publisher, format, coverage, or note. All source references are in this one JSON
file. Add another object to a section's `sources` array to add a resource; use
`download: true` for a downloadable file. The template escapes displayed text.

The existing `afpd-radio-id-response-days.xlsx` spreadsheet is hosted in
`public/records/openmhz/`, alongside its OpenMHz source material. It is a
September 9–October 22, 2026 snapshot, not an automatically refreshed report.
Preserve its coverage and attribution qualifications when replacing it.

Run `make build` to regenerate the page, Police Radio link, and sitemap.
