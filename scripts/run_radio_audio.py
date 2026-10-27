#!/usr/bin/env python3
"""Download one date/talkgroup to R2, with paced fetches and 100-call commits."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys

from prepare_radio_day import prepare
from radio_config import valid_branch, valid_day, valid_talkgroup


def run(day, talkgroup, branch, mode='download', proof=''):
    day, talkgroup, branch = valid_day(day), valid_talkgroup(talkgroup), valid_branch(branch)
    os.environ['OPENMHZ_TARGET_BRANCH'] = branch
    os.environ['OPENMHZ_AUDIO_STORAGE'] = 'r2'
    if mode == 'recover':
        if not proof:
            raise ValueError('Recovery requires browser-verified proof; normal downloads never retry failures')
        from recover_verified_openmhz_audio import recover
        recover(Path.cwd(), day, talkgroup, Path(proof))
        publish()
        return
    result = prepare(Path.cwd(), day, talkgroup, fetch=True)
    print(json.dumps(result), flush=True)
    manifest = Path('records-pending-review/openmhz-manifests') / result['manifest']
    processed = False
    while manifest.exists():
        processed = True
        summary = str(Path(os.environ['RUNNER_TEMP']) / 'openmhz-download-summary.json')
        subprocess.run([sys.executable, '-u', 'scripts/download_openmhz_manifest.py',
                        '--manifest', manifest.name, '--batch-size', '100', '--summary', summary], check=True)
        if os.environ.get('GITHUB_STEP_SUMMARY'):
            with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as output:
                output.write(Path(summary).read_text() + '\n')
        publish()
    # Also persist metadata copied from the other working branch on a no-op run.
    if not processed:
        publish()
    print(f'{day} talkgroup {talkgroup}: finished on {branch}; known failures remain separate.', flush=True)


def publish():
    subprocess.run(['npm', 'run', 'build'], check=True)
    subprocess.run(['bash', 'scripts/push_openmhz_import.sh'], check=True)


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--date', required=True)
    p.add_argument('--talkgroup', type=int, default=6001)
    p.add_argument('--target-branch', default='staging')
    p.add_argument('--mode', choices=['download', 'recover'], default='download')
    p.add_argument('--proof', default='')
    a = p.parse_args()
    run(a.date, a.talkgroup, a.target_branch, a.mode, a.proof)
