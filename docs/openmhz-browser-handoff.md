# Browser-to-R2 audio handoff

Collect source metadata using the normal OpenMHz page with autoplay disabled.
Preserve actual call IDs, timestamps, download links and radio IDs together.
Use Mountain date boundaries and record partial-day cutoffs honestly.

Save preserved metadata under
`records-pending-review/openmhz-metadata/CHANNEL/YYYY-MM-DD/calls.json`, where
CHANNEL is `car-to-car`, `law-2` or `6036`. Metadata preservation alone does not
start audio downloads.

To download, run **Download radio audio** with `day`, `talkgroup` and
`target_branch`, or commit `records-pending-review/openmhz-audio-request.json`.
Existing browser-collected active manifests still trigger the same generic
action. They must satisfy `scripts/download_openmhz_manifest.py`; the plain
`YYYY-MM-DD.json` filename remains supported for legacy 6001 handoffs.

The action stores checksum-verified audio in R2 and commits metadata to the
selected working branch. It waits two seconds after each download attempt,
skips known failures, and checkpoints every 100 calls. No ZIP or scheduled ZIP
poller is needed. See [Reusable radio actions](radio-workflows.md) for the
input schema, independent multi-day requests and explicit recovery option.
