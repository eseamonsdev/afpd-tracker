# Transcription helpers

Reference material for interpreting radio recordings and selecting short,
relevant hints for additional transcription runs. This folder is separate from
the audio archives, `calls.json`, and temporary ASR checkpoints.

## Files

- `reference-catalog.json`: starter names and terminology, grouped by category,
  with sources, spoken forms, observed recognition errors, and evidence limits.
  Includes parks, apartment communities, businesses, named streets, officer
  candidates, agency call signs, and radio terms. This is not an exhaustive
  directory or an AFPD protocol/codebook.
- `name-phonetics.json`: generated master pronunciation map for places, people,
  and sourced nicknames. Currently covers 97 places and 22 people, with 260
  forms. Each form includes machine-generated IPA and its reference status.
  Local pronunciations still need listening review.
- `training-examples.json`: clips or segments personally selected by the owner
  because the words are especially clear. It starts empty. A human-verified
  transcript does not automatically qualify as a training example.
- `evaluation-cases.json`: actual comparisons of prompts and results. The first
  case documents both the successful Art Dye hint and the broader list that
  damaged “Cole.” Evaluation cases are separate from curated training examples.

## How to use the references

Keep independent, unhinted original and filtered passes as evidence. Review
their differences using the recording, nearby exchanges before and after it,
and only relevant catalog entries. For an unresolved span, rerun with a few
plausible candidates and save the exact hint and output. Compare the entire
result with the baselines, including words outside the targeted span. Then
reconcile using the audio rather than choosing the most confident-looking text.

For example, “Art Dye Park” corrected “an art die” in October 12 clip 7. A prompt
with ten local place names instead produced “an Art Dye call,” losing “Cole.”
An appropriate additional experiment could include both the place candidate
and the addressed first name. Its result still needs checking against the audio.

The full catalog is for the reconciler to consult; do not paste it into every
ASR prompt. Catalog membership alone does not establish that a name was spoken.
An addressed name and the person transmitting are often different people.
Radio-ID associations are supporting evidence and do not establish the speaker
in every clip. McKay and Makai remain separate candidates. A proposed nickname
or phonetic error is not an automatic substitution rule.

Preserve `transcript_original` permanently. Keep accepted current transcripts,
notes and verification flags unless a specific correction is authorized. New
machine outputs never become human-verified automatically. Retain uncertainty
where the available evidence does not resolve it.

## Place coverage

The October 30 expansion adds 45 entries: five apartment/townhome communities,
17 park/field references, and 23 landmarks or civic sites. Totals are now 13
apartment/townhome communities and 34 park/field entries, alongside the other
place categories. The map represents all 35 names in the city's March 31, 2026
council-packet existing-open-space table, including trails and special-use
facilities. That table is part of a general-plan draft and is used as a name
inventory, not as proof that the draft was adopted.

New communities include Millpond, The Fields at Timpanogos, The Kelton,
Edgewater Townhomes, and the historical Pacific Drive Apartments planning name.
This does not establish every individual building number or cover every rental
building in the city. Public landmark references include the boat harbor, river
and canal trails, Fox Hollow, the cemetery, library, fitness center, hospital,
temple, Veterans Hall, Harrington, and selected downtown historic sites.
American Fork Canyon and Timpanogos Cave are regional candidates outside the
city core. Historical park names carry historical status; no undocumented rename
is inferred. Shared or generic names still require geographic context.

## Phonetic lookup for places, names and nicknames

Edit `reference-catalog.json` as the master source, then rebuild the generated
`name-phonetics.json`. Include a source for each new entry or nickname, record
whether it is owner-confirmed, observed only in ASR, or an unverified proposal,
and preserve date and branch limits. This is an initial reference list, not a
complete current business directory or officer roster. Archived business names
may no longer be current.

The map includes full names, listed first names and surnames, and sourced
nickname forms. T-Ball and G-Ball retain the owner's identification as Tanner
Ballamis; D-Ball and B-Ball remain recognition errors and are not searchable
aliases. Jackie retains the October 4 confirmation limit. Sammy remains an
existing reference form requiring specific clip review. Sam returns both
Halladay and Canizalez; McKay and Makai also remain separate people. A sound
match does not identify who transmitted, even when a radio ID is associated.
Preserve a spoken nickname rather than expanding it to a legal name.

Install optional pronunciation dependencies in a virtual environment and build:

```sh
python -m pip install -r scripts/name-phonetics-requirements.txt
python scripts/build_radio_name_phonetics.py
```

IPA lookup uses the standard library and the checked-in map. Paste only the
unclear name span from the audio phoneme decoder, not the surrounding sentence:

```sh
python scripts/match_radio_names.py --phonemes 'ɑː n ɚ ɹ ə n' --kind place
python scripts/match_radio_names.py --phonemes 's æ m' --kind person
```

For a contextual comparison, explicitly restrict the candidates:

```sh
python scripts/match_radio_names.py --phonemes 'ɑː n ɚ ɹ ə n' \
  --candidate-id business-on-the-run --candidate-id road-feature-on-ramp
```

Text guesses can also be converted to sounds using the optional dependencies:

```sh
python scripts/match_radio_names.py --text 'T-Ball' --kind person
```

Text conversion does not decode audio or provide independent evidence. The
lookup returns ranked candidates, matched forms, IPA, source IDs, reference and
nickname status, and evidence notes. Similarity is a simple weighted edit score
on IPA symbols, not calibrated confidence. A short noisy span can match unrelated
names; ranking first does not mean a candidate was spoken. Review alternatives,
including names absent from the map, against the recording and nearby exchanges.
Generated IPA can mispronounce local names; a confirmed spelling or nickname does
not verify the generated pronunciation.

On the Run retains separate west-side and State Street location references.
“The Run” is an ASR-observed short-form candidate, not a confirmed local nickname.
Neither its presence nor a high lookup score resolves October 28 clip 13.
Observed ASR errors stay in evidence fields rather than becoming legitimate
aliases. The tools write no transcripts, inject no hints, and run no workflow.

Validation:

```sh
python -m unittest discover -s tests -p test_name_phonetics.py
```

## Adding a selected training example

Use the stable audio filename, date and talkgroup. Match the audio checksum
when preparing it. For a clear portion of a longer clip, include explicit start
and end seconds and the exact words in that portion. These fields are a
curation format; a model-specific preparation step is still required.

```json
{
  "talkgroup": 6001,
  "date": "YYYY-MM-DD",
  "filename": "dcfems-6001-EPOCH.m4a",
  "sha256": "verified audio SHA-256",
  "start_seconds": 0.0,
  "end_seconds": 2.5,
  "confirmed_text": "The exact words spoken in the selected segment.",
  "teaches": ["place-name"],
  "selected_by": "owner"
}
```

The curated segment text is intentional: it is a reviewed example and should
not silently change when the full clip's current transcript is edited. Original
and current full-clip transcripts remain in `calls.json`.

## Integration status

This folder is reference material. Creating it does not change production
transcription settings, automatically inject hints, retranscribe the archive,
or train a model. The current automated third pass still uses preceding text.
Pilot targeted hints against selected clips and clear examples before changing
the generic transcription pipeline. Log prompt choices and compare both fixes
and regressions; the first successful clip is not an accuracy benchmark.
