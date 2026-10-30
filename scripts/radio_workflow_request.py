#!/usr/bin/env python3
"""Resolve validated, independent date/talkgroup/branch jobs for Actions."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess

from radio_config import DEFAULT_PAUSE_MS, valid_branch, valid_day, valid_talkgroup, valid_pause_ms

REQUEST_FILES = {'audio': 'records-pending-review/openmhz-audio-request.json',
                 'transcribe': 'records-pending-review/openmhz-transcription-request.json'}


def requests(payload, default_branch='staging'):
    defaults = {k: payload[k] for k in ('talkgroup', 'target_branch', 'mode', 'proof', 'selection', 'pause_ms') if k in payload}
    rows = payload.get('requests')
    if rows is None:
        rows = [{'day': d} for d in payload['days']] if 'days' in payload else [payload]
    if not isinstance(rows, list) or not 1 <= len(rows) <= 32:
        raise ValueError('Provide one to 32 date requests')
    result = []
    for entry in rows:
        row = {**defaults, **entry}
        mode = row.get('mode') or 'download'
        if mode not in ('download', 'recover'):
            raise ValueError('Audio mode must be download or recover')
        proof = row.get('proof') or ''
        if proof and not re.fullmatch(r'records-pending-review/openmhz-queues/[\w.-]+\.json', proof):
            raise ValueError('Proof must name a JSON file in the queue directory')
        result.append({'day': valid_day(row.get('day') or row.get('date')),
                       'talkgroup': valid_talkgroup(row.get('talkgroup', 6001)),
                       'target_branch': valid_branch(row.get('target_branch') or default_branch),
                       'mode': mode, 'proof': proof,
                       'pause_ms': valid_pause_ms(row.get('pause_ms', DEFAULT_PAUSE_MS))})
        if 'selection' in row:
            if row['selection'] not in ('all', 'afpd_missing'):
                raise ValueError('Unknown transcription selection')
            if row['selection'] == 'afpd_missing' and result[-1]['talkgroup'] != 5922:
                raise ValueError('AFPD selection requires Law 2')
            result[-1]['selection'] = row['selection']
    if len({(r['day'], r['talkgroup'], r['target_branch']) for r in result}) != len(result):
        raise ValueError('Duplicate radio jobs in request')
    return result


def changed_paths(root, event):
    before = event.get('before', '')
    if re.fullmatch(r'[0-9a-f]{40}', before) and before != '0' * 40:
        cmd = ['git', 'diff', '--name-only', before, 'HEAD']
    else:
        cmd = ['git', 'show', '--pretty=format:', '--name-only', 'HEAD']
    return subprocess.check_output(cmd, cwd=root, text=True).splitlines()


def resolve(root, kind, env):
    # A reusable workflow inherits the caller's event name, including push.
    if env.get('INPUT_DAY') or env.get('GITHUB_EVENT_NAME') != 'push':
        return requests({'day': env.get('INPUT_DAY'), 'talkgroup': env.get('INPUT_TALKGROUP') or 6001,
                         'target_branch': env.get('INPUT_BRANCH') or 'staging',
                         'mode': env.get('INPUT_MODE') or 'download', 'proof': env.get('INPUT_PROOF') or '',
                         'pause_ms': env.get('INPUT_PAUSE_MS') or DEFAULT_PAUSE_MS})
    event = json.loads(Path(env['GITHUB_EVENT_PATH']).read_text())
    changed = changed_paths(root, event)
    request_file = REQUEST_FILES[kind]
    if request_file in changed and (root / request_file).is_file():
        return requests(json.loads((root / request_file).read_text()), env['GITHUB_REF_NAME'])
    result = []
    if kind == 'audio':
        for name in changed:
            if re.fullmatch(r'records-pending-review/openmhz-manifests/[\w.-]+\.json', name) and (root / name).is_file():
                data = json.loads((root / name).read_text())
                result.extend(requests({'day': data['date'], 'talkgroup': data['talkgroup']}, env['GITHUB_REF_NAME']))
    return list({(r['day'], r['talkgroup'], r['target_branch']): r for r in result}.values())


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('kind', choices=REQUEST_FILES)
    a = p.parse_args()
    rows = resolve(Path.cwd(), a.kind, os.environ)
    with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
        output.write('matrix=' + json.dumps({'include': rows}, separators=(',', ':')) + '\n')
        output.write('has_work=' + str(bool(rows)).lower() + '\n')
    print(json.dumps(rows, indent=2))
