#!/usr/bin/env bash
set -euo pipefail

git config user.name 'github-actions[bot]'
git config user.email '41898282+github-actions[bot]@users.noreply.github.com'
git add -A -- public
pending_path=records-pending-review/openmhz-manifests
if [[ -d "$pending_path" ]] || [[ -n "$(git ls-files -- "$pending_path")" ]]; then
  git add -A -- "$pending_path"
fi
if git diff --cached --quiet; then
  exit 0
fi
git commit -m 'Import browser-collected OpenMHz audio directly and rebuild site'

# Save the downloaded result before touching the branch history. A failed push
# must not require another paced download of the entire day.
git bundle create "$RUNNER_TEMP/openmhz-import.bundle" HEAD^..HEAD

for attempt in 1 2 3; do
  git fetch origin staging
  if ! git rebase origin/staging; then
    conflicts=$(git diff --name-only --diff-filter=U)
    if [[ "$conflicts" == 'public/records/openmhz/index.json' ]]; then
      # This index is derived from the merged manifests and audio, so rebuild it
      # instead of choosing either side and dropping the other day's entries.
      node --input-type=module -e "import { buildRadioIndex } from './lib/build-radio-index.js'; buildRadioIndex();"
      git add public/records/openmhz/index.json
      GIT_EDITOR=true git rebase --continue
    else
      git rebase --abort
      echo 'Staging has conflicting changes; downloaded audio retained in the recovery bundle.' >&2
      exit 1
    fi
  fi
  if git push origin HEAD:staging; then
    exit 0
  fi
  echo "Push attempt $attempt failed; fetching staging again without re-downloading audio." >&2
done
echo 'Unable to push after three attempts; downloaded audio retained in the recovery bundle.' >&2
exit 1
