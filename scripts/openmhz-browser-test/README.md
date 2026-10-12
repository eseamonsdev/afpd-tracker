# OpenMHz browser URL collection experiment

This isolated test opens the normal OpenMHz website in stock headless Chromium,
filters `dcfems` to talkgroup **6001**, and scrolls both directions from midday
**September 30, 2026 (America/Denver)** until it has crossed both day boundaries.
It observes the call-list responses already requested by the website and extracts
their audio URLs. It does not issue its own API requests or download audio.

The website's call-list requests are serialized with at least five seconds between
starts. No stealth settings, imported session cookies, or challenge-solving logic
are used. HTTP failures, verification pages, pagination stalls, and request/scroll
limits produce a failed result rather than a silently incomplete inventory.

The result is compared by call ID and audio URL against the checked-in September
30 archive (83 calls). Both midnight boundaries must also be reached. A successful
run establishes URL discovery from that runner on that day; it does not establish
that subsequent audio transfers will work or that future runs cannot be blocked.

The separate `Test OpenMHz browser URL collection` workflow runs on matching test
file pushes to staging/the experiment branch, or manually once available in the
default branch. It has no daily schedule, repository write permissions, import,
site build, or deployment step. The existing ZIP importer is unchanged.

Artifacts: `urls.txt`, `calls.json`, `summary.json`, `browser-batches.json`, and the
last page's HTML and screenshot. Diagnostic output may contain adjacent-day call
metadata used to prove the boundary; `urls.txt` and `calls.json` contain only the
target day and talkgroup.

Local use (Node 22+):

```sh
cd scripts/openmhz-browser-test
npm ci
npx playwright install --with-deps chromium
OUTPUT_DIR=/tmp/openmhz-browser-results npm run collect
```
