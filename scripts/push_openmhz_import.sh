#!/usr/bin/env bash
set -euo pipefail

if [[ "${OPENMHZ_AUDIO_STORAGE:-}" == 'r2' ]]; then
  python3 scripts/r2_audio.py
fi

target_branch="${OPENMHZ_TARGET_BRANCH:-staging}"
case "$target_branch" in staging|law-2) ;; *) echo 'Invalid radio target branch' >&2; exit 1;; esac

git config user.name 'github-actions[bot]'
git config user.email '41898282+github-actions[bot]@users.noreply.github.com'
git add -A -- public
pending_path=records-pending-review/openmhz-manifests
if [[ -d "$pending_path" ]] || [[ -n "$(git ls-files -- "$pending_path")" ]]; then
  git add -A -- "$pending_path"
fi
failure_path=records-pending-review/openmhz-failures
if [[ -d "$failure_path" ]] || [[ -n "$(git ls-files -- "$failure_path")" ]]; then
  git add -A -- "$failure_path"
fi
metadata_path=records-pending-review/openmhz-metadata
if [[ -d "$metadata_path" ]]; then git add -A -- "$metadata_path"; fi
# ZIP imports remove their source bundle after validation.
if [[ -n "$(git ls-files -- 'records-pending-review/*.zip')" ]] || compgen -G 'records-pending-review/*.zip' > /dev/null; then
  git add -A -- 'records-pending-review/*.zip'
fi
if git diff --cached --quiet; then
  exit 0
fi
git commit -m 'Checkpoint OpenMHz metadata and verified audio storage'

# Save the downloaded result before touching the branch history. A failed push
# must not require another paced download of the entire day.
git bundle create "$RUNNER_TEMP/openmhz-import.bundle" HEAD^..HEAD

for attempt in 1 2 3; do
  git fetch origin "$target_branch"
  if ! git rebase "origin/$target_branch"; then
    conflicts=$(git diff --name-only --diff-filter=U)
    if [[ "$conflicts" == 'public/records/openmhz/index.json' ]]; then
      # This index is derived from the merged manifests and audio, so rebuild it
      # instead of choosing either side and dropping the other day's entries.
      node --input-type=module -e "import { buildRadioIndex } from './lib/build-radio-index.js'; buildRadioIndex();"
      git add public/records/openmhz/index.json
      GIT_EDITOR=true git rebase --continue
    else
      git rebase --abort
      echo 'Target branch has conflicting changes; downloaded audio retained in the recovery bundle.' >&2
      exit 1
    fi
  fi
  if git push origin "HEAD:$target_branch"; then
    exit 0
  fi
  echo "Push attempt $attempt failed; fetching $target_branch again without re-downloading audio." >&2
done
echo 'Unable to push after three attempts; downloaded audio retained in the recovery bundle.' >&2
exit 1
