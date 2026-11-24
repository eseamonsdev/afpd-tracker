#!/usr/bin/env python3
"""Download one date/talkgroup to R2, with paced fetches and 300-call commits."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys

from prepare_radio_day import prepare
from download_openmhz_manifest import DEFAULT_BATCH_SIZE, RATE_LIMIT_EXIT_CODE, validate_manifest, write_json
from radio_config import DEFAULT_PAUSE_MS, TALKGROUPS, valid_branch, valid_day, valid_talkgroup, valid_pause_ms


def run(day, talkgroup, branch, mode='download', proof='', pause_ms=DEFAULT_PAUSE_MS):
    pause_ms = valid_pause_ms(pause_ms)
    day, talkgroup, branch = valid_day(day), valid_talkgroup(talkgroup), valid_branch(branch)
    os.environ['OPENMHZ_TARGET_BRANCH'] = branch
    os.environ['OPENMHZ_AUDIO_STORAGE'] = 'r2'
    if mode == 'recover':
        if not proof:
            raise ValueError('Recovery requires browser-verified proof; normal downloads never retry failures')
        from recover_verified_openmhz_audio import recover
        recover(Path.cwd(), day, talkgroup, Path(proof), pause_ms=pause_ms)
        publish()
        return
    result = prepare(Path.cwd(), day, talkgroup, fetch=True)
    print(json.dumps(result), flush=True)
    manifest = Path('records-pending-review/openmhz-manifests') / result['manifest']
    processed = download_queue(manifest, pause_ms)
    # Retry the remaining failed downloads once, after the normal queue drains.
    # Keep the failure manifest intact until the importer validates each recovery.
    channel = TALKGROUPS[talkgroup][0]
    failure = Path('records-pending-review/openmhz-failures') / f'{day}-{channel}.json'
    if failure.exists():
        retry = json.loads(failure.read_text())
        validate_manifest(retry)
        if retry['date'] != day or retry['talkgroup'] != talkgroup:
            raise ValueError('Failure manifest identity mismatch')
        retry['calls'] = [c for c in retry['calls'] if c.get('audio_status') != 'unavailable']
        retry['count'] = len(retry['calls'])
        if retry['count']:
            for call in retry['calls']:
                call.pop('download_error', None)
            retry.pop('retry_note', None)
            validate_manifest(retry)
            manifest.parent.mkdir(parents=True, exist_ok=True)
            write_json(manifest, retry)
            print(f'Retrying {retry["count"]} failed calls once', flush=True)
            download_queue(manifest, pause_ms)
            processed = True
    if not processed:
        publish()
    print(f'{day} talkgroup {talkgroup}: finished on {branch}; any remaining failures are recorded separately.', flush=True)


def download_queue(manifest, pause_ms):
    processed = False
    while manifest.exists():
        processed = True
        summary = str(Path(os.environ['RUNNER_TEMP']) / 'openmhz-download-summary.json')
        try:
            subprocess.run([sys.executable, '-u', 'scripts/download_openmhz_manifest.py',
                            '--manifest', manifest.name, '--batch-size', str(DEFAULT_BATCH_SIZE),
                            '--pause-ms', str(pause_ms), '--summary', summary], check=True)
        except subprocess.CalledProcessError as error:
            if error.returncode != RATE_LIMIT_EXIT_CODE:
                raise
            # Upload verified audio and persist the remaining queue before failing.
            publish(build=False)
            if os.environ.get('GITHUB_STEP_SUMMARY'):
                with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as output:
                    output.write('Stopped on HTTP 429. Progress saved; remaining clips are pending.\n')
                    output.write(Path(summary).read_text() + '\n')
            raise
        if os.environ.get('GITHUB_STEP_SUMMARY'):
            with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as output:
                output.write(Path(summary).read_text() + '\n')
        # Save each checkpoint, but regenerate the site only on the last batch.
        publish(build=not manifest.exists())
    return processed


def publish(build=True):
    # Persist verified downloads before rendering pages, which also builds
    # unrelated officer associations. A rendering error must not lose progress.
    subprocess.run(['bash', 'scripts/push_openmhz_import.sh'], check=True)
    if build:
        subprocess.run(['npm', 'run', 'build'], check=True)
        subprocess.run(['bash', 'scripts/push_openmhz_import.sh'], check=True)


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--date', required=True)
    p.add_argument('--talkgroup', type=int, default=6001)
    p.add_argument('--target-branch', default='staging')
    p.add_argument('--mode', choices=['download', 'recover'], default='download')
    p.add_argument('--proof', default='')
    p.add_argument('--pause-ms', type=valid_pause_ms, default=DEFAULT_PAUSE_MS)
    a = p.parse_args()
    run(a.date, a.talkgroup, a.target_branch, a.mode, a.proof, a.pause_ms)
