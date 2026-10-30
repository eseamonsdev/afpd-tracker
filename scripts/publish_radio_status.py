#!/usr/bin/env python3
"""Publish public recording counts; no credentials, transcripts or run links."""
import argparse
import json
import os
import subprocess
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from r2_audio import client_and_bucket, stored_audio


def snapshot(root, branch, state):
    rows = {}
    def row(day, group):
        return rows.setdefault((day, group), {'date': day, 'talkgroup': group, 'saved_names': set(), 'downloaded_names': set(), 'failed_names': set(), 'total_names': set(), 'expected': 0, 'inventory_known': False, 'coverage': 'unknown'})
    def include(d, kind, folder=None):
        if not d.get('date') or d.get('talkgroup') not in (6001, 5922, 6036): return
        r = row(d['date'], d['talkgroup'])
        for c in d.get('calls', []):
            name = c.get('original_filename')
            if not name: continue
            r['total_names'].add(name)
            if kind == 'archive' and stored_audio(c, folder):
                r['saved_names'].add(name)
                r['downloaded_names'].add(name)
            elif kind == 'failure': r['failed_names'].add(name)
        if kind in ('source', 'archive'):
            r['inventory_known'] = True
            r['expected'] = max(r['expected'], len({c['original_filename'] for c in d.get('calls', []) if c.get('original_filename')}))
        if kind == 'source' and r['coverage'] == 'unknown': r['coverage'] = d.get('coverage', 'unknown')
        if kind == 'archive': r['coverage'] = d.get('coverage', 'unknown')
    for p in (root / 'public/records/openmhz').glob('*/calls.json'):
        include(json.loads(p.read_text()), 'archive', p.parent.name)
    for p in (root / 'records-pending-review/openmhz-metadata').glob('*/*/calls.json'):
        include(json.loads(p.read_text()), 'source')
    for directory, kind in [('openmhz-manifests', 'queue'), ('openmhz-failures', 'failure')]:
        for p in (root / 'records-pending-review' / directory).glob('*.json'):
            include(json.loads(p.read_text()), kind)
    queue = root / 'records-pending-review/openmhz-audio-request.json'
    if queue.exists():
        from radio_workflow_request import requests
        for request in requests(json.loads(queue.read_text()), branch):
            if request['target_branch'] == branch:
                row(request['day'], request['talkgroup'])
    progress = Path(os.environ.get('RUNNER_TEMP', '/tmp')) / 'radio-download-progress.json'
    if (progress.exists() and branch == os.environ.get('OPENMHZ_TARGET_BRANCH', 'staging')
            and os.environ.get('DAY') and os.environ.get('TALKGROUP')):
        for d in json.loads(progress.read_text()).values():
            if (d['date'] != os.environ['DAY']
                    or str(d['talkgroup']) != os.environ['TALKGROUP']):
                continue
            r = row(d['date'], d['talkgroup'])
            for name, status in d['files'].items():
                r['total_names'].add(name)
                if status == 'failed':
                    if name not in r['saved_names']: r['failed_names'].add(name)
                elif status == 'downloaded':
                    r['downloaded_names'].add(name)
                    r['failed_names'].discard(name)
    # Every calendar date is visible for every talkgroup, including days whose
    # inventory has not been collected. A collected empty inventory stays zero.
    if rows:
        day = date.fromisoformat(min(d for d, _ in rows))
        end = date.fromisoformat(max(d for d, _ in rows))
        while day <= end:
            for group in (6001, 5922, 6036): row(day.isoformat(), group)
            day += timedelta(days=1)
    result = []
    for r in rows.values():
        r['failed_names'] -= r['saved_names']
        total = max(r['expected'], len(r['total_names']))
        known = r['inventory_known'] or total > 0
        result.append({k: r[k] for k in ('date', 'talkgroup', 'coverage')} | {'inventory_known': known, 'total': total if known else None, 'downloaded': len(r['downloaded_names']), 'saved': len(r['saved_names']), 'failed': len(r['failed_names']), 'remaining': max(0, total-len(r['downloaded_names'])-len(r['failed_names'])) if known else None})
    commit = subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=root, capture_output=True, text=True).stdout.strip()
    return {'updated_at': datetime.now(timezone.utc).isoformat(), 'branch': branch, 'commit': commit or None, 'state': state, 'rows': sorted(result, key=lambda r: (r['date'], r['talkgroup']), reverse=True)}


def publish(root, branch, state, publish_page=False):
    client, bucket = client_and_bucket()
    data = snapshot(root, branch, state)
    client.put_object(Bucket=bucket, Key=f'radio-status/{branch}.json', Body=(json.dumps(data)+'\n').encode(), ContentType='application/json; charset=utf-8', CacheControl='no-store')
    if publish_page:
        page = (Path(__file__).resolve().parents[1] / 'public/police-radio-status.html').read_bytes()
        for key in ('police-radio-status.html', 'radio-status/index.html'):
            client.put_object(Bucket=bucket, Key=key, Body=page, ContentType='text/html; charset=utf-8', CacheControl='no-store')
    print('Recording status published:', branch, state, flush=True)

if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('--branch', choices=['staging', 'main'], default=os.environ.get('OPENMHZ_TARGET_BRANCH', 'staging'))
    p.add_argument('--root', type=Path, default=Path.cwd())
    p.add_argument('--publish-page', action='store_true')
    p.add_argument('--state', default='running')
    p.add_argument('--watch', action='store_true')
    args = p.parse_args()
    while True:
        try: publish(args.root, args.branch, args.state, publish_page=args.publish_page)
        except Exception as error:
            print('Status update failed:', type(error).__name__, flush=True)
            if not args.watch: raise
        if not args.watch: break
        time.sleep(10)
