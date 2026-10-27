#!/usr/bin/env python3
"""Recover earliest retained 6001 transcripts from Git without editing current wording."""
import argparse
from collections import Counter
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import subprocess

CALL = re.compile(r'dcfems-6001-(\d+)\.m4a')


def git(root, *args, input=None):
    return subprocess.check_output(['git', *args], cwd=root, input=input)


def events(root, ref):
    patterns = ['public/records/openmhz/openmhz-afpd-car-to-car-*/calls.json',
                'public/records/openmhz/openmhz-afpd-car-to-car-*/transcript.md',
                'public/records/openmhz/openmhz-afpd-car-to-car-*/transcript-drafts/*.md']
    raw = git(root, 'log', '-m', '--reverse', '--topo-order', '--full-history', '--no-renames',
              '--raw', '--no-abbrev', '--format=COMMIT %H%x00%ct%x00%s', ref, '--', *patterns).decode()
    result = []
    for line in raw.splitlines():
        if line.startswith('COMMIT '):
            commit, timestamp, subject = line[7:].split('\0', 2)
        elif line.startswith(':'):
            fields, path = line.split('\t', 1)
            old_sha, sha = fields.split()[2:4]
            if sha != '0' * 40:
                result.append({'commit': commit, 'timestamp': int(timestamp), 'subject': subject,
                               'path': path, 'blob': sha, 'old_blob': old_sha})
    return result


def read_blobs(root, shas):
    # Fetch just transcript/metadata blobs together, never the historical audio.
    ordered = sorted(set(shas))
    subprocess.run(['git', 'fetch', '--no-tags', '--no-write-fetch-head', '--filter=blob:none',
                    '--stdin', 'origin'], cwd=root, input=('\n'.join(ordered)+'\n').encode(),
                   stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, check=True)
    raw = git(root, 'cat-file', '--batch', input=('\n'.join(ordered)+'\n').encode())
    position = 0
    result = {}
    for sha in ordered:
        end = raw.index(b'\n', position)
        header = raw[position:end].split()
        if len(header) != 3 or header[1] != b'blob':
            raise ValueError('Missing historical transcript blob: '+sha)
        size = int(header[2]); position = end+1
        result[sha] = raw[position:position+size].decode('utf-8')
        position += size+1
    return result


def markdown_entries(text):
    result = {}
    for line in text.splitlines():
        # Source audio links establish identity; never map by a mutable clip number.
        match = re.search(r'\[Audio\]\([^\n)]*(dcfems-6001-\d+\.m4a)\)\s*[—–-]\s*(.*)$', line)
        if match:
            name, transcript = match.groups()
            if name in result and result[name]['text'] != transcript:
                raise ValueError('Ambiguous duplicate Markdown audio identity: '+name)
            result[name] = {'text': transcript, 'reviewed': False, 'sha256': None}
    return result


def json_entries(text):
    data = json.loads(text)
    calls = data.get('calls', []) if isinstance(data, dict) else data
    result = {}
    for c in calls:
        transcript = c.get('transcript')
        name = c.get('original_filename') or c.get('filename')
        if not isinstance(transcript, str) or not transcript.strip() or not isinstance(name, str):
            continue
        if not CALL.fullmatch(name):
            continue
        entry = {'text': transcript, 'reviewed': c.get('validated') is True,
                 'sha256': c.get('sha256')}
        if name in result and result[name] != entry:
            raise ValueError('Ambiguous duplicate JSON audio identity: '+name)
        result[name] = entry
    return result


def recover(history, blobs):
    """Earliest retained published text wins; verification never selects a baseline."""
    first = {}; warnings = []; seen = set(); audio_hashes = {}
    for event in history:
        key = (event['path'], event['blob'])
        if key in seen:
            continue
        seen.add(key)
        if event['path'].endswith('.json'):
            data = json.loads(blobs[event['blob']])
            calls = data.get('calls', []) if isinstance(data, dict) else data
            for call in calls:
                name = call.get('original_filename') or call.get('filename')
                if name and call.get('sha256'):
                    audio_hashes[name] = call['sha256']
            entries = json_entries(blobs[event['blob']]); kind = 'calls.json'
        else:
            entries = markdown_entries(blobs[event['blob']]); kind = 'legacy_markdown'
            if CALL.search(blobs[event['blob']]) and not entries:
                warnings.append({'commit': event['commit'], 'path': event['path'],
                                 'issue': 'Unrecognized Markdown transcript format'})
        for name, entry in entries.items():
            if entry['text'].strip():
                first.setdefault(name, {**entry, 'sha256': entry.get('sha256') or audio_hashes.get(name),
                                        'commit': event['commit'], 'path': event['path'], 'kind': kind,
                                        'subject': event['subject']})
    return first, warnings


def backfill(root, ref='origin/staging', write=False):
    history = events(root, ref)
    blobs = read_blobs(root, [sha for e in history for sha in (e['blob'], e['old_blob']) if sha != '0' * 40])
    first, warnings = recover(history, blobs)
    report = {'schema_version': 1, 'reference': git(root, 'rev-parse', ref).decode().strip(),
              'generated_at_utc': datetime.now(timezone.utc).isoformat(),
              'history_commits': len({e['commit'] for e in history}),
              'historical_text_blobs': len(blobs), 'selection_rule': 'Earliest nonempty published transcript by audio filename across calls.json and transcript.md history, including merge results; no verification flag used to select a baseline.', 'days': [], 'unresolved': [],
              'warnings': warnings, 'totals': Counter()}
    for path in sorted((root/'public/records/openmhz').glob('openmhz-afpd-car-to-car-*/calls.json')):
        data = json.loads(path.read_text())
        stats = Counter(); provenance = []; changed = False
        for c in data['calls']:
            text = c.get('transcript')
            if not isinstance(text, str) or not text.strip():
                continue
            stats['transcripts'] += 1
            if c.get('validated') is True: stats['verified'] += 1
            if 'transcript_original' in c:
                stats['already_preserved'] += 1
                continue
            name = c['original_filename']
            candidate = first.get(name)
            if candidate is None:
                report['unresolved'].append({'date': data['date'], 'filename': name,
                    'verified': c.get('validated') is True,
                    'issue': 'No earlier retained transcript found in JSON or Markdown'})
                stats['unresolved'] += 1
                continue
            if candidate.get('sha256') and c.get('sha256') and candidate['sha256'] != c['sha256']:
                report['unresolved'].append({'date': data['date'], 'filename': name,
                                            'issue': 'Historical audio checksum differs'})
                stats['unresolved'] += 1
                continue
            if candidate['reviewed']:
                report['warnings'].append({'date': data['date'], 'filename': name,
                    'issue': 'Earliest retained version already marked reviewed; initial AI wording is unproven'})
            c['transcript_original'] = candidate['text']
            changed = True; stats['originals_added'] += 1
            stats['different_from_current'] += candidate['text'] != text
            stats[candidate['kind']] += 1
            provenance.append({'filename': name, 'commit': candidate['commit'],
                               'path': candidate['path'], 'kind': candidate['kind']})
        if changed and write:
            path.write_text(json.dumps(data, ensure_ascii=False, indent=2)+'\n')
        groups = {}
        for source in provenance:
            key=(source['commit'],source['path'],source['kind'])
            groups.setdefault(key,[]).append(source['filename'])
        sources=[{'commit':commit,'path':path,'kind':kind,'filenames':names}
                 for (commit,path,kind),names in groups.items()]
        report['days'].append({'date': data['date'], **stats, 'sources': sources})
        report['totals'].update(stats)
    if write:
        output=root/'findings/6001-transcript-originals-audit.json'
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n')
    return report


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--root', type=Path, default=Path.cwd())
    p.add_argument('--ref', default='origin/staging')
    p.add_argument('--write', action='store_true')
    p.add_argument('--report', type=Path)
    a = p.parse_args()
    report = backfill(a.root.resolve(), a.ref, a.write)
    if a.report: a.report.write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n')
    print(json.dumps({'days':len(report['days']), **{k:v for k,v in report.items() if k in ('history_commits','historical_text_blobs','totals','unresolved','warnings')}}, indent=2))
