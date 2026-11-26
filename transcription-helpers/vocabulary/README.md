# Transcription vocabulary by category

These nine JSON files contain 206 vocabulary entries, seeded from the existing
reference catalog, officer records, and reviewed project transcript wording.
They contain words and spelling variants only: no audio samples, sample arrays,
word timestamps, or phonetic results. They are not a complete local directory.

| File | Entries | Contents |
| --- | ---: | --- |
| `officers.json` | 91 | Every project officer record, including former personnel |
| `parks.json` | 34 | Parks, fields, and recreation names |
| `communities.json` | 13 | Apartment and townhome communities |
| `businesses.json` | 11 | Business and brand names |
| `named-streets.json` | 17 | Named streets, including Pacific Drive and Chipman |
| `landmarks.json` | 17 | Landmarks, trails, and the FrontRunner station |
| `civic-facilities.json` | 7 | Civic facilities and the hospital |
| `jurisdictions.json` | 9 | City, county, and service-area names |
| `local-terminology.json` | 7 | Selected nonnumeric terms and road-feature words |

## Structure and identifiers

Each file has `schema_version`, `category`, `purpose`, and an `entries` object.
The keys in `officers.json` are the exact existing officer filename/profile IDs,
such as `dustin-r-renter` and `m-marquel-whetton`. `entity_id` separately retains
the corresponding `entity-person-...` identifier. Display names and aliases do
not create new officer identities. The file includes all officer records and
must not be treated as a current-duty roster.

Existing catalog IDs are retained for other categories. New entries have stable,
descriptive IDs. Preserve IDs when adjusting a display spelling. An example:

```json
{
  "schema_version": 1,
  "category": "officers",
  "purpose": "Transcription vocabulary candidates; membership does not confirm a word was spoken.",
  "entries": {
    "dustin-r-renter": {
      "name": "Dustin R. Renter",
      "entity_id": "entity-person-dustin-r-renter",
      "spoken_forms": ["Dustin R. Renter", "Dustin", "Renter"],
      "reference_status": "roster_spelling; spoken_forms_are_lookup_candidates",
      "sources": [
        {"path": "data/entities/people/officers/dustin-r-renter.json"}
      ]
    }
  }
}
```

`spoken_forms` are lookup forms, not claims of confirmed local pronunciation.
`alternate_names` retain documented identity spellings from the roster; not all
are observed radio forms. `nickname_forms` preserve the existing evidence status
and limits of nicknames. `candidate_forms` separately holds explicitly uncertain
variants such as Sammy or the Run. Recognition errors such as D-Ball and B-Ball
are not promoted to legitimate aliases. Shared names such as Sam and similar
names such as McKay/Makai remain attached to separate officers.

`sources` point to existing repository references; they are provenance for the
word list, not curated audio samples. `reference_status`, `historical_reference`,
`spoken_form_notes`, and `notes` preserve spelling, history, and alias limits.
Source wording does not establish a current business address, branch, preferred
nickname, current employment, or identification of a speaker. Opposite terms
such as affirmative and negative have separate entries.

## Scope

Numbered streets, numbered overpasses, numeric radio/status codes, agency call
signs, and standalone radio initialisms are excluded. A number within an actual
community name, such as Elevate at 620, is retained as part of that proper name.
Addresses are not copied into the vocabulary. Chipman remains Chipman without
inventing a street suffix. Pacific Drive and Pacific Drive Apartments, and Mill
Pond and Millpond Apartments, remain distinct entries.

These files are transcription reference data only. This change does not modify
transcripts, uncertainty markings, officer associations, model settings, the
running phonetic backfill, or public pages. The existing mixed reference catalog
and generated `name-phonetics.json` remain available to existing tools. The new
category files are independently editable; they are not automatically regenerated
from the older catalog or automatically consumed by the current matching tools.
Future sample curation or matching integration can use these stable entry keys.
