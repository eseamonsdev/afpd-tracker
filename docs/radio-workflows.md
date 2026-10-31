# Reusable radio actions

Use **Download radio audio** (`radio-audio.yml`) or **Generate radio transcription
passes** (`radio-transcribe.yml`) in GitHub Actions. Both accept:

| Input | Default | Meaning |
| --- | --- | --- |
| `day` | Required | Mountain calendar date, `YYYY-MM-DD` |
| `talkgroup` | `6001` | `6001`, `5922` (Law 2), or `6036` |
| `target_branch` | `staging` | `staging` only |

All radio development uses staging. The retired `law-2` branch was consolidated into staging on October 28, 2026. The talkgroup selects the channel. For example, `day=2026-10-24`,
`talkgroup=5922`, `target_branch=staging` downloads Law 2 onto staging. The same
inputs work for transcription once that branch contains the verified R2 archive.
These actions also expose the same inputs through `workflow_call`.

## Start an action without workflow-dispatch access

Commit `records-pending-review/openmhz-audio-request.json` for downloads, or
`records-pending-review/openmhz-transcription-request.json` for transcription:

```json
{
  "day": "2026-10-24",
  "talkgroup": 5922,
  "target_branch": "staging",
  "requested_at": "2026-10-27T12:00:00Z"
}
```

Use a fresh request timestamp to trigger an explicit rerun. Legacy transcription
requests using `date` instead of `day` still work. A request may contain `days`
or a `requests` array for up to 32 independent jobs. Transcription runs up to 15 distinct days concurrently on standard hosted
runners; audio downloads remain sequential. The transcription lock is scoped
to branch, talkgroup and date, preventing duplicate writers for the same day.
A failed date does not cancel the other requested dates. Do not depend
on matrix ordering; request one date at a time when strict ordering is needed.

Pushing a changed active manifest under
`records-pending-review/openmhz-manifests/` also starts the audio action, on staging. Only the changed date/talkgroup is selected; parked manifests and
unrelated dates are not swept into the run. Code changes alone do not download
audio or start transcription. Completed runs do not keep processing future days.

## Audio behavior

Preserved metadata must already exist. The action uses local staging metadata or fetches only the requested metadata file from remote staging. Existing queue checkpoints resume.
The downloader skips saved audio and known failures, fetches sequentially, waits
**1,000 milliseconds after every attempt**, and publishes a checkpoint every 300 calls.
Override the pause with the audio workflow's `pause_ms` input, a request JSON
`"pause_ms": 500`, or CLI `--pause-ms 500`. The value is a nonnegative integer
in milliseconds and applies to both normal downloads and verified recovery.
The pause is measured after the preceding attempt finishes, including failures.
This setting controls pacing; it is not a guarantee against source rate limits.
Each checkpoint uploads and verifies audio in R2 and saves metadata to staging.
Only newly downloaded audio is validated and uploaded. Existing verified R2
recordings retain their hashes, sizes, storage proof and transcripts without
being downloaded or re-read. Whole-archive integrity checks are separate from
ordinary downloads and recovery; explicit `r2_audio.py --hydrate` remains available.
The full Eleventy site build runs only with the final batch for each requested
date/talkgroup, rather than at every checkpoint. Interrupted runs retain their
saved progress; generated pages and indexes catch up when the resumed run finishes.

Resume is normal behavior, not a separate workflow. An explicit `mode=recover`
request can recover known failures only when `proof` names a browser-verified
JSON file under `records-pending-review/openmhz-queues/`. Recovery selects only
the requested date/talkgroup and proven call IDs. Normal downloads never retry
known failures. Publication failures preserve a Git recovery bundle.

Audio jobs retain the shared `openmhz-zip-import` concurrency key to avoid
overlapping with older runs already holding that lock. The name is retained
for lock compatibility; no ZIP importer remains installed.

## Transcription behavior

The action reads checksum-verified R2 objects into temporary runner storage,
uses the pinned original, filtered and context passes, and saves text candidates
every 200 clips (and at the end or on interruption) under `transcription-work/TALKGROUP/YYYY-MM-DD/` on the chosen
branch. Matching saved passes resume; changed audio/settings or identities fail.
Temporary audio is removed after each saved batch and on exit. No audio or
models enter Git or artifacts. It processes the actual saved archive and retains
its source-coverage status; it does not claim missing source audio was recovered.

Raw passes are not final transcripts. The daily ChatGPT task still reconciles
every clip's three outputs, preserves user corrections and uncertainty, publishes
to `calls.json`, regenerates exports, and removes completed text checkpoints.
The existing daily task remains talkgroup 6001 on staging; the generic actions
are usable for all three talkgroups on staging.

## Utilities and removed workflows

**Publish radio recording counts** accepts a target branch and includes all
saved talkgroups on it. **Verify AFPD R2 connection** is a repeatable storage
diagnostic; it does not choose a date or archive destination.

The Law 2 day/queue workflows, 6001-only transcription workflow, separate
verified-recovery workflow, old manifest downloader, and scheduled ZIP importer
were replaced or removed. ZIP import is no longer part of the unattended path;
the old local validator remains available for historical bundles.

### Missing AFPD-associated Law 2 calls

A transcription request may specify `"selection": "afpd_missing"` with talkgroup
5922. It selects only calls without current transcripts whose radio IDs occur
on 6001, excluding explicit non-AFPD corrections. Existing verified entries are
excluded. All archive indices, saved hashes, settings and checkpoints remain
unchanged; the normal three preceding-call context rule uses the full archive,
including original passes from other agencies when required. Matching saved
passes are reused. Full-archive status counts still include unselected calls;
a completed selection does not establish complete-day transcription.

Targeted AFPD selections checkpoint after at most ten target clips so reconciliation
can proceed while later batches run. Whole-archive runs retain their 200-clip
processing interval. Checkpoint file layout remains ten archive clips per file.


## Generic browser metadata collection

The [local Playwright collector](../scripts/openmhz-browser-test/README.md) accepts any Utah County `dcfems` talkgroup: `node collect-openmhz.cjs --talkgroup=6223 --date=2026-10-29`. The audit runner accepts `--talkgroups=ID,ID --dates=DAY,DAY --known-ids=PATH` and processes each day/group sequentially. It retains every source-ID entry and reports exact reference-list overlaps and completeness separately. These inspection tools do not download audio or publish archive changes.

## Dispatch-only transcription

Set `"selection": "dispatch_missing"` in a Law 2 transcription request to process
only recordings whose source IDs include the player's owner-configured `904`
dispatch prefix. Existing published transcripts and human-verified clips are
excluded; saved three-pass results are skipped on resume. Preceding calls may
receive an original-only pass when needed for the context pass, but only dispatch
targets receive all three passes. Each date remains a separate matrix job, with
one job running at a time under the existing staging transcription lock.
Dispatch selection checkpoints every 100 targets, retaining the same model and
settings as AFPD selection.

### Remaining calls across all radio IDs

Use `"selection": "missing"` to process every unpublished, unverified call,
regardless of radio ID. Matching completed passes are reused, partial passes
resume, and unavailable target/context audio stays pending. Checkpoints are
pushed every 100 newly processed targets and at the end or on interruption.
Checkpoint files retain their ten-archive-clip layout. Different days write
separate directories; pushes rebase and retry with jitter up to 30 times when
other jobs advance staging. Reconciliation remains separate.
