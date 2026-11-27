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

## Reviewed examples

Forms with matching reviewed examples now contain a `samples` array. Forms with
no qualifying examples retain `{}`. There are 556 examples from 492 distinct
clips across 94 spoken forms:

| Category | Examples |
| --- | ---: |
| Officers | 291 |
| Businesses | 43 |
| Communities | 4 |
| Parks | 12 |
| Named streets | 46 |
| Jurisdictions | 18 |
| Local terminology | 142 |

Each example includes `date`, `talkgroup`, `clip_number`, `audio_filename`,
`reviewed_sentence`, `phonetic_result_key`, and, when emitted, `word_phonemes`.
Repeated occurrences of the same form in a clip have a one-based `occurrence`
field. Word start/end timestamps are omitted.

The source sentence must have `validated: true` in the current archive. The target
word must occur outside uncertainty brackets. This is an index of reviewed
transcript examples, not a declaration that every predicted phone or extracted
word boundary was human-verified. It does not change the separate owner-selected
training example collection.

`phonetic_result_key` is the exact existing R2 object key in
`afpd-public-media`, including the Allosaurus uni2005 model hash, settings hash,
and source-audio checksum. The referenced object retains both English and
unrestricted output. `word_phonemes` contains an approximate English-inventory
portion of that independent saved output; it is not a pronunciation generated
from the spelling.

Word locations were estimated internally with TorchAudio 2.5.1's
`WAV2VEC2_ASR_BASE_960H` and CTC forced alignment of the reviewed sentence.
Allosaurus emissions in that estimated interval were selected with 40 ms padding
and a 22.5 ms analysis-window midpoint offset. The earlier reviewed Renter
comparison supplies one shared-r boundary correction. Alignment locates the
portion; it does not replace or correct any Allosaurus sounds. These extracted
portions can miss or include boundary sounds and need listening review before
being treated as precise phonetic reference samples. One Neil example has no
Allosaurus emissions in its estimated word portion: it keeps the recording and
result reference but omits `word_phonemes` instead of inventing sounds.

No ambiguous occurrence is copied under both possible officers or locations.
The four assigned Sam occurrences use the existing explicit named-response
references or the literal phrase Sam Halladay. The other 19 Sam mentions and
five Millpond/Mill Pond mentions are retained in
`../vocabulary-review/pending-samples.json` for assignment review. Two Chipman
mentions clearly refer to the road and are included there, not under the park.
Five false category matches are excluded: Jordan in West/South Jordan, a person
named Hunter, and generic uses of state.

These files are not yet wired into the transcription or matching pipeline.
