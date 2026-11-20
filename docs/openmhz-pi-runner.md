# Manual OpenMHz collection on a Raspberry Pi

The workflow `.github/workflows/collect-openmhz-pi.yml` runs only when manually dispatched. It has no schedule.

## Pi setup

Use a 64-bit Raspberry Pi OS and install Git, GNU Make and Chromium. Register a GitHub Actions self-hosted runner for this repository, add the custom label `openmhz`, and install/start its service. The workflow requires the labels `self-hosted`, `Linux`, `ARM64` and `openmhz`. Node 22 is supplied by the workflow.

From a terminal in the Pi's desktop session, start Chromium and leave it running:

```sh
chromium --remote-debugging-port=9222 --remote-debugging-address=127.0.0.1 \
  --user-data-dir="$HOME/.config/chromium-openmhz" \
  "https://openmhz.com/system/dcfems?filter-type=talkgroup&filter-code=6001"
```

The runner must be able to reach that browser at `http://127.0.0.1:9222`. A runner service does not need its own display because the collector attaches to the existing browser. If OpenMHz asks for browser verification, complete it in the Pi's desktop session.

## Run manually

GitHub requires the workflow file on the default branch (`main`) before it appears as a manually runnable workflow. Promote the workflow to main when ready; its checkout and output branch remain explicitly fixed to staging.

Open Actions → Collect OpenMHz metadata on Pi → Run workflow. Enter a finished America/Denver calendar date and select 6001 (Car-to-Car), 5922 (Law 2), or 6036.

The workflow checks out seven individual files from staging, installs only the collector's Node dependencies, and calls `make collect-openmhz`. It then adds just the selected day's metadata path. No website build dependencies, site archive, audio files, or full Git history are checked out.

Completed metadata is committed to staging at:

| Talkgroup | Destination |
| --- | --- |
| 6001 | `records-pending-review/openmhz-metadata/car-to-car/YYYY-MM-DD/calls.json` |
| 5922 | `records-pending-review/openmhz-metadata/law-2/YYYY-MM-DD/calls.json` |
| 6036 | `records-pending-review/openmhz-metadata/6036/YYYY-MM-DD/calls.json` |

Incomplete collection fails without publishing the handoff. Raw calls, browser batches, summary and diagnostics are kept in the run artifact for seven days, including on failure. A publication recovery patch is included when a commit was created. Push retries reuse the completed collection and never force-push staging. Concurrent changes to the same metadata file stop publication for manual review.

This workflow preserves source metadata only. It does not download audio, enable transcripts, create audio requests, or deploy the site. No additional secret is required: commits use the workflow's repository token with `contents: write` permission.
