# IDs-only radio agency table

`public/records/openmhz/radio-agency-identifiers.json` is the dedicated source
for radio IDs, 5J identifiers and dated Law 2 evidence. It contains no names.
`src/_data/radioAgencyIds.js` loads it for the rendered helper page. The page
also refreshes the two table bodies from this file in the browser, keeping
previously generated pages aligned with the latest table data.

Update this source, the CSV and the workbook together. The historical mixed
resource entity still supplies the rest of the helper page; its old agencyIds
section is superseded by this dedicated file. A pairing does not assign a
person to a radio. Dated person confirmations are separate player metadata in
`officer-confirmations.json`.
