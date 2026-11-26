# Transcription vocabulary

Each category file is a plain mapping from a stable ID to its spoken forms.
Each form has its own object:

```json
{
  "tanner-m-ballamis": {
    "Tanner": {},
    "T-Ball": {}
  },
  "dustin-r-renter": {
    "Renter": {}
  }
}
```

The officer IDs are the existing filename/profile/database IDs. There are no
entity-person identifiers, display names, alternate-name lists, provenance
fields, reference-status fields, or top-level schema wrappers.

`officers.json` starts with 36 officers and 50 selected spoken forms supported
by reviewed transcript wording and existing name links. It is not a roster.
Do not automatically expand an officer's legal name into first-name, surname,
or full-name candidates. Add a form only when there is a relevant example.
Words inside uncertainty brackets were excluded when selecting these forms.
Ambiguous textual matches such as Vessel Kitchen, Call her, and Papa John's do
not establish officer name forms. Shared forms such as Sam remain separate
under the supported officer IDs; the word alone does not identify a speaker.

The other files contain place, business, street, jurisdiction, and terminology
word lists. They retain stable existing keys and use the same nested-form
structure. Jurisdictions contain geographic names only, without agency call
signs or agency-prefix metadata. Numbered streets and numeric codes are omitted.
The original mixed reference catalog retains historical-name and source notes;
place vocabulary membership does not establish current operation or confirmed
radio pronunciation. Explicitly proposed abbreviations were not promoted.

All form objects are empty for now, as requested. Later, each can hold its own
reviewed examples and links to saved phonetic results. No samples, phonetic
results, or word start/end times have been added. These files are not yet wired
into the transcription or matching pipeline.
