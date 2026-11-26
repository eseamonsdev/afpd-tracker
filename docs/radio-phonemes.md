# Saved radio phonetic recognition

`radio-phonemes.yml` decodes all archived clips from every supported talkgroup
(6001, 5922, and 6036) with Allosaurus 1.0.2 / uni2005. Up to 15 talkgroup/day
workers run in parallel. Each reads verified audio from R2, checks its size and
SHA-256, converts the original recording to mono 16 kHz PCM WAV, and saves both
English (`eng`) and unrestricted (`ipa`) phone inventories. There is no minimum
speech duration, VAD, transcript prompting, noise filter, or name matching.

These are machine predictions, not verified transcripts or voice embeddings.
Archive transcripts, validation flags, speaker vectors, and public pages are
never edited. Name matching is a separate operation on saved phonetic output.

## Model identity and R2 layout

The release archive and the complete extracted model file tree are pinned by
SHA-256. The model tree checksum matches the initial Renter experiments:
`92d783125d0eb8173066058bc61ff805389430cf811b149250a4a62b6efc9a2b`.

The configured `R2_BUCKET_NAME` is the same bucket as the source archive audio
(currently `afpd-public-media`). Keys are:

```text
voice-recognition/allosaurus--uni2005--MODEL-SHA256/TALKGROUP/
  phonemes/DATE/settings-CONFIGURATION-SHA256/
    clips/AUDIO-STEM--AUDIO-SHA256.json
    phonemes.json
```

The configuration fingerprint includes the decoding settings, library versions,
Python version, and ffmpeg version. Changed models, audio, or settings produce
separate results. Successful per-clip JSON is immutable, conditionally created,
and readback-verified; reruns validate and reuse it without audio downloads or
decoding. Each contains both raw sequences and per-phone emission timestamps.
Allosaurus's 45 ms analysis windows are explicitly not phone durations or precise
word boundaries. Empty output is saved as decoded empty output, not a named word.

The daily `phonemes.json` is a progress manifest updated every 100 clips and at
completion. It preserves original clip numbers and references the per-clip keys
and checksums. A successful clip is saved before advancing, even between manifest
checkpoints. It records reused, new, decoded, unavailable, and error counts.
Errors are retried on rerun; successful results remain intact. One clip's failure
does not stop the rest of a day. An error makes the job fail after writing its
final manifest; explicit source-unavailable clips remain listed as unavailable.
`complete` is true only if every clip was decoded; `attempted_all` means the
worker reached the end, including unavailable/error entries.

## Run and resume

Update `records-pending-review/radio-phoneme-request.json` on staging, changing
`request_id` to retrigger an identical selection:

```json
{
  "request_id": "unique-request-id",
  "days": "all",
  "talkgroups": "all",
  "batch_index": 0
}
```

Dates and talkgroups can also be comma-separated selections. The planner scans
actual archive metadata and rejects identity mismatches. Selections larger than
256 archives require consecutive zero-based `batch_index` requests; the plan
reports the total batch count. The November 26 backfill has 161 archives, so one
request covers all 110,130 entries, including four source-unavailable clips.

Manual workflow dispatch is available once this workflow is on the default
branch. Code-only pushes run tests without launching audio work. A run always
checks out a fixed source commit. There is one concurrency group per model,
talkgroup, and day, so retries cannot overwrite simultaneous processing of the
same day's manifest. The workflow uses existing R2 secrets/variables and
read-only GitHub permissions. Daily progress artifacts are retained 90 days;
permanent results live in R2 independently of artifact retention.

Local planning needs only the standard library:

```sh
python scripts/radio_phonemes.py plan --days all --talkgroups all
python -m unittest discover -s tests -p test_radio_phonemes.py
```

For processing, install CPU torch 2.5.1, ffmpeg, and
`scripts/requirements-radio-phonemes.txt`, then supply the existing R2 settings:

```sh
python scripts/radio_phonemes.py run --day 2026-11-24 --talkgroup 6036 \
  --model-dir /tmp/radio-phoneme-models --output /tmp/radio-phonemes --publish
```

The initial run computes phonetic data only. It does not schedule ongoing
processing for future days; an explicit repeat request reuses all completed
clips and fills missing results.
