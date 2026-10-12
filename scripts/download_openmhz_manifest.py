#!/usr/bin/env python3
"""Download browser-collected 6001 manifests directly into the radio archive."""
import argparse
import hashlib
import json
import math
import re
import shutil
import subprocess
import tempfile
import time
import urllib.request
from datetime import date, datetime, time as day_time, timedelta, timezone
from pathlib import Path
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

MOUNTAIN = ZoneInfo('America/Denver')
GAP_SECONDS = 5
MAX_AUDIO_BYTES = 20 * 1024 * 1024
MAX_CALLS = 5000
MEDIA_HOSTS = {'media.openmhz.com', 'media2.openmhz.com'}


def write_json(path, data):
    path.write_text(json.dumps(data, indent=2) + '\n')


def validate_call(call, day):
    epoch = call.get('epoch')
    seconds = call.get('displayed_seconds')
    filename = call.get('original_filename')
    if (not isinstance(epoch, int) or isinstance(epoch, bool)
            or not isinstance(seconds, (int, float)) or isinstance(seconds, bool)
            or not math.isfinite(seconds) or seconds < 0
            or call.get('talkgroup') != 6001
            or not isinstance(call.get('id'), str) or not call['id']
            or filename != f'dcfems-6001-{epoch}.m4a'):
        raise ValueError('Invalid call metadata or audio filename')
    if datetime.fromtimestamp(epoch, MOUNTAIN).date().isoformat() != day:
        raise ValueError('Call falls outside the Mountain date')
    media = urlparse(call.get('media_url', ''))
    if (media.scheme != 'https' or media.hostname not in MEDIA_HOSTS
            or media.username or media.password or media.port not in (None, 443)
            or media.path != f'/media/dcfems/6001/{filename}' or media.fragment):
        raise ValueError('Unexpected media URL: only the exact OpenMHz audio path is allowed')


def validate_manifest(data):
    day = data.get('date', '')
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', day):
        raise ValueError('Invalid date')
    date.fromisoformat(day)
    cutoff = datetime.fromisoformat(data.get('collected_through_utc', '').replace('Z', '+00:00'))
    if cutoff.tzinfo is None or cutoff.astimezone(MOUNTAIN).date().isoformat() != day:
        raise ValueError('Cutoff must include a timezone and fall on the target Mountain date')
    if cutoff > datetime.now(timezone.utc) + timedelta(minutes=5):
        raise ValueError('Cutoff cannot be in the future')
    calls = data.get('calls')
    if (data.get('timezone') != 'America/Denver' or data.get('system') != 'dcfems'
            or data.get('talkgroup') != 6001 or data.get('coverage') != 'partial'
            or not isinstance(calls, list) or not 0 < len(calls) <= MAX_CALLS
            or data.get('count') != len(calls)):
        raise ValueError('Invalid source manifest')
    ids = set()
    for call in calls:
        validate_call(call, day)
        if call['id'] in ids or call['epoch'] > cutoff.timestamp():
            raise ValueError('Duplicate ID or call after the collection cutoff')
        ids.add(call['id'])
    return day


class NoRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError('Unexpected audio redirect; stopped for review')


class Downloader:
    """One request at a time, five seconds after completion of the last attempt."""
    def __init__(self):
        self.finished_at = None
        self.opener = urllib.request.build_opener(NoRedirects())

    def download(self, url, destination):
        if self.finished_at is not None:
            time.sleep(max(0, GAP_SECONDS - (time.monotonic() - self.finished_at)))
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'afpd-tracker-archive/1.0'})
            with self.opener.open(req, timeout=60) as response:
                content_type = response.headers.get('Content-Type', '').lower()
                if 'text/html' in content_type or 'application/json' in content_type:
                    raise ValueError('Audio URL returned a non-audio response')
                content = response.read(MAX_AUDIO_BYTES + 1)
            if len(content) > MAX_AUDIO_BYTES or len(content) < 12 or content[4:8] != b'ftyp':
                raise ValueError('Response is not a valid-sized M4A file')
            destination.write_bytes(content)
        finally:
            self.finished_at = time.monotonic()


def inspect_audio(path, call):
    content = path.read_bytes()
    if len(content) < 12 or content[4:8] != b'ftyp':
        raise ValueError(f'Invalid M4A: {path.name}')
    digest = hashlib.sha256(content).hexdigest()
    if call.get('sha256') and call['sha256'] != digest:
        raise ValueError(f'Existing checksum mismatch: {path.name}')
    probe = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration',
                            '-of', 'default=noprint_wrappers=1:nokey=1', str(path)],
                           capture_output=True, text=True, check=True, timeout=30)
    duration = float(probe.stdout.strip())
    if not math.isfinite(duration) or duration <= 0 or abs(duration - call['displayed_seconds']) > 1:
        raise ValueError(f'Unexpected audio duration: {path.name}')
    return {'size_bytes': len(content), 'sha256': digest, 'audio_duration_seconds': duration}


def import_manifest(root, source, downloader):
    data = json.loads(source.read_text())
    day = validate_manifest(data)
    if source.name != f'{day}.json':
        raise ValueError('Source manifest name must match its date')
    destination = root / 'public/records/openmhz' / f'openmhz-afpd-car-to-car-{day}'
    old = json.loads((destination / 'calls.json').read_text()) if (destination / 'calls.json').exists() else None
    if destination.exists() and old is None:
        raise ValueError('Existing archive folder has no manifest')
    if old and (old.get('date') != day or old.get('talkgroup') != 6001):
        raise ValueError('Existing archive identity does not match')
    merged = {call['original_filename']: dict(call) for call in (old or {}).get('calls', [])}
    ids = {call['id']: name for name, call in merged.items()}
    downloaded = skipped = 0
    duplicates = list((old or {}).get('duplicate_source_calls', []))
    # Keep all changes temporary until every requested recording validates.
    with tempfile.TemporaryDirectory(prefix='openmhz-manifest-') as temp:
        temp = Path(temp)
        for incoming in sorted(data['calls'], key=lambda call: (call['epoch'], call['id'])):
            name = incoming['original_filename']
            if incoming['id'] in ids and ids[incoming['id']] != name:
                raise ValueError('Source ID changed its audio filename')
            previous = merged.get(name)
            audio = destination / name
            if previous and audio.exists():
                inspect_audio(audio, previous)
                skipped += 1
                if previous['id'] != incoming['id'] and not any(x['id'] == incoming['id'] for x in duplicates):
                    duplicates.append(incoming)
                continue
            audio = temp / name
            if not audio.exists():
                downloader.download(incoming['media_url'], audio)
                downloaded += 1
            call = dict(incoming)
            call.update(inspect_audio(audio, call))
            instant = datetime.fromtimestamp(call['epoch'], timezone.utc)
            call['timestamp_utc'] = instant.isoformat().replace('+00:00', 'Z')
            call['timestamp_mountain'] = instant.astimezone(MOUNTAIN).strftime('%Y-%m-%d %H:%M:%S')
            call['talkgroup_name'] = 'American Fork PD Car to Car'
            if previous and previous['id'] != call['id']:
                duplicates.append(call)
            else:
                merged[name] = call
                ids[call['id']] = name
        calls = sorted(merged.values(), key=lambda call: (call['epoch'], call['id']))
        start = datetime.combine(date.fromisoformat(day), day_time.min, MOUNTAIN)
        result = dict(old or {})
        result.update(date=day, timezone='America/Denver', system='dcfems', talkgroup=6001,
                      count=len(calls), calls=calls,
                      start_utc=start.astimezone(timezone.utc).isoformat().replace('+00:00', 'Z'),
                      end_utc_exclusive=(start + timedelta(days=1)).astimezone(timezone.utc).isoformat().replace('+00:00', 'Z'))
        result['coverage'] = (old or {}).get('coverage', 'partial') if old else 'partial'
        cutoffs = [datetime.fromisoformat(data['collected_through_utc'].replace('Z', '+00:00'))]
        if (old or {}).get('collected_through_utc'):
            cutoffs.append(datetime.fromisoformat(old['collected_through_utc'].replace('Z', '+00:00')))
        cutoff = max(cutoffs).astimezone(timezone.utc).isoformat().replace('+00:00', 'Z')
        result['collected_through_utc'] = cutoff
        if duplicates:
            result['duplicate_source_calls'] = duplicates
            result['source_call_count'] = len(calls) + len(duplicates)
        destination.mkdir(parents=True, exist_ok=True)
        for audio in temp.glob('*.m4a'):
            shutil.copyfile(audio, destination / audio.name)
        write_json(destination / 'calls.json', result)
        write_json(destination / 'rows.json', [call.get('row', '') for call in calls])
        write_json(destination / 'validation.json', {'date': day, 'count': len(calls), 'downloaded': downloaded,
                   'skipped_existing': skipped, 'validated': True, 'coverage': result['coverage'],
                   'collected_through_utc': cutoff, 'minimum_pause_after_download_seconds': GAP_SECONDS})
        (destination / 'README.txt').write_text(f'OpenMHz AFPD car-to-car (6001), {day}, America/Denver.\n'
            f'Coverage: {result["coverage"]}; collected through {cutoff}.\n'
            'Source: OpenMHz (https://openmhz.com/). Original audio bytes retained.\n'
            'Downloaded directly from browser-collected URLs; no ZIP intermediate.\n')
    return {'date': day, 'count': len(calls), 'downloaded': downloaded, 'skipped_existing': skipped}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path.cwd())
    parser.add_argument('--summary', type=Path, required=True)
    args = parser.parse_args()
    root = args.root.resolve()
    pending = sorted((root / 'records-pending-review/openmhz-manifests').glob('*.json'))
    for source in pending:
        validate_manifest(json.loads(source.read_text()))
    downloader = Downloader()
    results = [import_manifest(root, source, downloader) for source in pending]
    if results:
        subprocess.run(['node', '--input-type=module', '-e',
                        "import { buildRadioIndex } from './lib/build-radio-index.js'; buildRadioIndex();"], cwd=root, check=True)
        for source in pending:
            source.unlink()
    write_json(args.summary, results)
    print(json.dumps(results, indent=2))


if __name__ == '__main__':
    main()
