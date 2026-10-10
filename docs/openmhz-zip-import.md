# Permanent OpenMHz ZIP importer

Upload one or more `openmhz-afpd-car-to-car-YYYY-MM-DD.zip` files to
`records-pending-review` on `staging`, committing the whole batch together.
The **Import OpenMHz ZIPs** action automatically validates and extracts them,
rebuilds the radio index, tests and builds the site, and opens one pull request
targeting `staging`. Review and merge that PR, then use the usual staging
promotion process. The workflow stays installed; it never deletes itself.

The workflow also checks `staging` daily at 07:00 UTC and supports **Run workflow**
in the Actions tab once installed on the default branch. It processes uploaded
ZIPs only; it does not fetch new recordings from OpenMHz. Empty runs do nothing.
Do not upload the next batch until the previous import PR is merged, to avoid
overlapping import PRs. Rerunning the same source commit reuses its branch/PR.

ZIPs use the existing flat layout: original `dcfems-6001-EPOCH.m4a` filenames,
`calls.json`, `rows.json`, `download-checkpoint.json`, `validation.json`,
`README.txt`, and `STATUS.txt`. Dates use America/Denver. Unsafe paths, missing
audio, extra audio, invalid manifests, size/hash mismatches, and conflicting
existing day folders stop the batch before extraction. Duplicate source calls
sharing one filename are retained as `duplicate_source_calls` in the manifest,
with `source_call_count`; the indexed calls contain each audio filename once.
Audio bytes are preserved. Only matching, successfully imported OpenMHz ZIPs
are removed; other pending-review documents remain untouched.

No personal credentials are required. GitHub's built-in token writes the import
branch. In **Settings → Actions → General → Workflow permissions**, enable
**Allow GitHub Actions to create and approve pull requests** so the action can
open PRs. If disabled, extraction and branch publication still complete, and
the failed run provides a compare link; enable the setting and rerun.

Local equivalent:

```sh
python3 -m unittest discover -s tests -p 'test_openmhz_import.py'
python3 scripts/import_openmhz_zips.py
node --test tests/police-radio.test.js
npm ci
npm run build
```
