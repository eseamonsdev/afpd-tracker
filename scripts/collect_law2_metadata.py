"""Preserve one Mountain day's Law 2 metadata from the OpenMHz API."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import subprocess
import time
from urllib.parse import urlencode, urlparse
from zoneinfo import ZoneInfo

from download_openmhz_manifest import day_bounds, validate_manifest, write_json

ENDPOINT = 'https://api.openmhz.com/dcfems/calls/newer'


def instant_ms(call):
    value = datetime.fromisoformat(call['time'].replace('Z', '+00:00'))
    if value.tzinfo is None:
        raise ValueError('Source time lacks timezone')
    return int(value.timestamp() * 1000)


def fetch_page(cursor):
    url = ENDPOINT + '?' + urlencode({'time':cursor, 'filter-type':'talkgroup', 'filter-code':'5922'})
    response = subprocess.check_output(['curl','--fail','--silent','--show-error','--max-time','30',url], text=True)
    data = json.loads(response)
    if not isinstance(data.get('calls'), list):
        raise ValueError('Unexpected OpenMHz metadata response')
    return data['calls']


def normalize(raw, day):
    if raw.get('talkgroupNum') != 5922:
        raise ValueError('Unexpected source talkgroup')
    epoch_ms = instant_ms(raw)
    if epoch_ms % 1000:
        raise ValueError('Fractional source timestamp needs identity review')
    epoch = epoch_ms // 1000
    url = raw['url']
    filename = urlparse(url).path.rsplit('/', 1)[-1]
    # Use the actual source URL; never invent it from a filename pattern.
    if filename != f'dcfems-5922-{epoch}.m4a':
        raise ValueError('Source URL/time identity discrepancy: ' + raw['_id'])
    sources = raw.get('srcList', [])
    ids = list(dict.fromkeys(str(s['src']) for s in sources if str(s.get('src','')).isdigit() and int(s['src']) > 0))
    instant = datetime.fromtimestamp(epoch, timezone.utc)
    return {'id':raw['_id'], 'epoch':epoch, 'timestamp_utc':instant.isoformat().replace('+00:00','Z'),
            'timestamp_mountain':instant.astimezone(ZoneInfo('America/Denver')).strftime('%Y-%m-%d %H:%M:%S'),
            'displayed_seconds':raw['len'], 'talkgroup':5922, 'talkgroup_name':'Law 2 Northeast',
            'original_filename':filename, 'media_url':url, 'media_url_source':'OpenMHz API call metadata',
            'radio_ids':ids, 'srcList':sources, 'source_api_time':raw['time']}


def collect(root, day, fetcher=fetch_page, pause=time.sleep):
    start, end = day_bounds(day)
    if end > datetime.now(timezone.utc):
        raise ValueError('Only finished dates can be collected')
    folder = root / 'records-pending-review/openmhz-metadata/law-2' / day
    folder.mkdir(parents=True, exist_ok=True)
    destination = folder / 'calls.json'
    if destination.exists():
        saved = json.loads(destination.read_text())
        validate_manifest(saved)
        if saved.get('collection', {}).get('date_window_paged') is True:
            return {'date':day,'calls':len(saved['calls']),'already_preserved':True}
    start_ms, end_ms = int(start.timestamp()*1000), int(end.timestamp()*1000)
    cursor = start_ms - 1
    raw_calls = {}
    crossed_end = False
    pages = 0
    for page in range(200):
        if page:
            pause(2)
        calls = fetcher(cursor)
        pages += 1
        if not calls:
            # An empty newer page means the source currently exposes no later calls.
            break
        times = [instant_ms(call) for call in calls]
        if min(times) <= cursor:
            raise ValueError('Source pagination did not honor its newer cursor')
        for call in calls:
            stamp = instant_ms(call)
            if start_ms <= stamp < end_ms:
                raw_calls[call['_id']] = call
        write_json(folder / 'source-api-calls.json', sorted(raw_calls.values(), key=lambda c:(c['time'],c['_id'])))
        print(json.dumps({'date':day,'metadata_calls':len(raw_calls),'pages':pages,'latest_source_time':max(call['time'] for call in calls)}), flush=True)
        latest = max(times)
        if latest >= end_ms:
            crossed_end = True
            break
        # Include the last timestamp again so calls sharing a second are retained.
        next_cursor = latest - 1
        if next_cursor <= cursor:
            raise ValueError('Source pagination stalled; checkpoint retained')
        cursor = next_cursor
    else:
        raise ValueError('Metadata page limit reached; checkpoint retained')
    if not raw_calls:
        raise ValueError('No calls exposed for requested date')
    normalized = [normalize(call, day) for call in sorted(raw_calls.values(), key=lambda c:(c['time'],c['_id']))]
    data = {'schema_version':1,'date':day,'timezone':'America/Denver','system':'dcfems','talkgroup':5922,
            'count':len(normalized),'coverage':'unknown','calls':normalized,
            'start_utc':start.astimezone(timezone.utc).isoformat().replace('+00:00','Z'),
            'end_utc_exclusive':end.astimezone(timezone.utc).isoformat().replace('+00:00','Z'),
            'collection':{'method':'OpenMHz API, talkgroup 5922, chronological pagination',
                          'date_window_paged':True,'observed_calls_beyond_day':crossed_end,
                          'pages':pages,'minimum_pause_between_pages_seconds':2,
                          'collected_at_utc':datetime.now(timezone.utc).isoformat(),
                          'coverage_note':'Preserves source-exposed calls; does not establish complete reception.'}}
    validate_manifest(data)
    write_json(destination,data)
    return {'date':day,'calls':len(normalized),'pages':pages,'source_exposes_later_date':crossed_end}


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--date',required=True)
    parser.add_argument('--root',type=Path,default=Path.cwd())
    args=parser.parse_args()
    print(json.dumps(collect(args.root.resolve(),args.date)),flush=True)
