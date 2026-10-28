"""Recover source IDs without replacing archived audio or transcript fields.

Network access uses the existing repository collector's OpenMHz newer endpoint.
October 1-18 API collection authorized by the user on October 28, 2026.
"""
import argparse
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import subprocess
import time
from urllib.parse import urlencode
from urllib.request import urlopen
from zoneinfo import ZoneInfo

ENDPOINT = 'https://api.openmhz.com/dcfems/calls/newer'
MOUNTAIN = ZoneInfo('America/Denver')


def merge_ids(manifest, sources):
    changed = 0
    for call in manifest['calls']:
        source = sources.get(call['id'])
        if source is None:
            continue
        epoch_ms = int(datetime.fromisoformat(source['time'].replace('Z', '+00:00')).timestamp()*1000)
        if epoch_ms != call['epoch']*1000 or source['talkgroupNum'] != 5922:
            raise ValueError('Source identity mismatch: ' + call['id'])
        src_list = source.get('srcList', [])
        ids = list(dict.fromkeys(str(s['src']) for s in src_list
                                if str(s.get('src', '')).isdigit() and int(s['src']) > 0))
        old = [str(i) for i in (call.get('radio_ids') or []) if str(i).isdigit() and int(i) > 0]
        if old and set(old) - set(ids):
            raise ValueError('Would remove existing source IDs: ' + call['id'])
        call['radio_ids'] = ids
        call['srcList'] = src_list
        call['detail_status'] = 'collected'
        call['radio_id_provenance'] = {
            'method': 'OpenMHz metadata API; exact call ID, timestamp and talkgroup match',
            'checked_at_utc': datetime.now(timezone.utc).isoformat(),
            'minimum_interval_seconds': 1,
        }
        changed += 1
    return changed


def collect(day, destination, fetch, pause=time.sleep, checkpoint_saved=None):
    start = datetime.fromisoformat(day).replace(tzinfo=MOUNTAIN)
    end = start + timedelta(days=1)
    start_ms, end_ms = int(start.timestamp()*1000), int(end.timestamp()*1000)
    cursor = start_ms - 1
    destination.mkdir(parents=True, exist_ok=True)
    checkpoint = destination / (day + '-source-radio-ids.json')
    sources = json.loads(checkpoint.read_text()) if checkpoint.exists() else {}
    if sources:
        cursor = max(int(datetime.fromisoformat(c['time'].replace('Z', '+00:00')).timestamp()*1000)
                     for c in sources.values()) - 1
    for page in range(200):
        if page:
            pause(1)
        response = fetch(cursor)
        calls = response.get('calls')
        if not isinstance(calls, list):
            raise ValueError('Unexpected metadata response')
        if not calls:
            break
        stamps = [int(datetime.fromisoformat(c['time'].replace('Z', '+00:00')).timestamp()*1000) for c in calls]
        if min(stamps) <= cursor:
            raise ValueError('Pagination did not advance')
        for call, stamp in zip(calls, stamps):
            if start_ms <= stamp < end_ms:
                if call['talkgroupNum'] != 5922:
                    raise ValueError('Unexpected talkgroup')
                sources[call['_id']] = call
        checkpoint.write_text(json.dumps(sources, indent=2)+'\n')
        print(f'{day}: {len(sources)} calls preserved; page {page+1}', flush=True)
        if checkpoint_saved:
            checkpoint_saved(checkpoint, day, len(sources))
        if max(stamps) >= end_ms:
            break
        next_cursor = max(stamps) - 1
        if next_cursor <= cursor:
            raise ValueError('Pagination stalled; checkpoint retained')
        cursor = next_cursor
    else:
        raise ValueError('Page limit reached; checkpoint retained')
    if not sources:
        raise ValueError('No source calls returned for ' + day)
    return sources


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--checkpoint-dir', type=Path, required=True)
    parser.add_argument('--commit', action='store_true')
    args = parser.parse_args()
    args.root = args.root.resolve()
    args.checkpoint_dir = args.checkpoint_dir.resolve()
    last_request = 0.0

    def git(*arguments, check=True):
        return subprocess.run(['git', *arguments], cwd=args.root, check=check,
                              text=True, capture_output=True)

    def save(paths, message):
        if not args.commit:
            return
        git('add', '--', *(str(p.relative_to(args.root)) for p in paths))
        if git('diff', '--cached', '--quiet', check=False).returncode == 0:
            return
        git('commit', '-m', message)
        for attempt in range(5):
            git('pull', '--rebase', 'origin', 'staging')
            result = git('push', 'origin', 'HEAD:staging', check=False)
            if result.returncode == 0:
                print('SAVED TO STAGING: ' + message, flush=True)
                return
            time.sleep(1)
        raise RuntimeError('Could not push checkpoint: ' + result.stderr)

    def checkpoint_saved(path, day, count):
        save([path], f'Preserve Law 2 {day} source radio metadata: {count} calls')

    def fetch(cursor):
        nonlocal last_request
        delay = 1 - (time.monotonic() - last_request)
        if delay > 0:
            time.sleep(delay)
        url = ENDPOINT + '?' + urlencode({'time': cursor, 'filter-type': 'talkgroup', 'filter-code': '5922'})
        try:
            with urlopen(url, timeout=30) as response:
                return json.load(response)
        finally:
            last_request = time.monotonic()

    for number in range(1, 19):
        day = f'2026-10-{number:02}'
        status_path = args.checkpoint_dir / 'status.json'
        status = json.loads(status_path.read_text()) if status_path.exists() else {}
        if status.get(day, {}).get('state') == 'completed':
            print(day + ': already recovered and saved; skipping.', flush=True)
            continue
        source = collect(day, args.checkpoint_dir, fetch, checkpoint_saved=checkpoint_saved)
        if args.commit:
            git('pull', '--rebase', 'origin', 'staging')
        paths = [args.root / f'public/records/openmhz/openmhz-afpd-law-2-{day}/calls.json',
                 args.root / f'records-pending-review/openmhz-metadata/law-2/{day}/calls.json']
        results = []
        for path in paths:
            if not path.exists():
                continue
            before = json.loads(path.read_text())
            after = json.loads(json.dumps(before))
            count = merge_ids(after, source)
            allowed = {'radio_ids', 'srcList', 'detail_status', 'radio_id_provenance'}
            for previous, updated in zip(before['calls'], after['calls']):
                assert {k:v for k,v in previous.items() if k not in allowed} == {k:v for k,v in updated.items() if k not in allowed}
            temp = path.with_suffix('.json.tmp')
            temp.write_text(json.dumps(after, indent=2)+'\n')
            temp.replace(path)
            results.append({'path':str(path.relative_to(args.root)), 'total_calls':len(after['calls']),
                            'source_matches':count, 'calls_with_ids':sum(bool(c.get('radio_ids')) for c in after['calls']),
                            'missing_ids':sum(not bool(c.get('radio_ids')) for c in after['calls'])})
            print(f'{day}: {count}/{len(after["calls"])} exact matches updated in {path}', flush=True)
        status[day] = {'state':'completed', 'source_calls':len(source), 'manifests':results,
                       'completed_at_utc':datetime.now(timezone.utc).isoformat()}
        status_path.write_text(json.dumps(status, indent=2)+'\n')
        save([p for p in paths if p.exists()] + [status_path], f'Recover Law 2 {day} radio IDs in archived call manifests')
        summary = os.environ.get('GITHUB_STEP_SUMMARY')
        if summary:
            with open(summary, 'a') as output:
                output.write(f'### {day}\n\n' + '\n'.join(f'- {r["path"]}: {r["calls_with_ids"]}/{r["total_calls"]} with IDs; {r["missing_ids"]} unavailable.' for r in results)+'\n\n')


if __name__ == '__main__':
    main()
