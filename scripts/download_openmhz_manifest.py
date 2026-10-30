#!/usr/bin/env python3
"""Download browser-collected radio manifests directly into the radio archive."""
import argparse
import os
import hashlib
import json
import math
import re
import shutil
import subprocess
import tempfile
import time
import urllib.request
import urllib.error
import http.client
from datetime import date, datetime, time as day_time, timedelta, timezone
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from zoneinfo import ZoneInfo
from r2_audio import audio_checks, stored_audio
from radio_config import DEFAULT_PAUSE_MS, valid_pause_ms


def record_status(day, talkgroup, name, status):
    """Private per-file progress; the public publisher uploads counts only."""
    if not os.environ.get('RUNNER_TEMP'):
        return
    try:
        path = Path(os.environ['RUNNER_TEMP']) / 'radio-download-progress.json'
        data = json.loads(path.read_text()) if path.exists() else {}
        key = f'{day}-{talkgroup}'
        entry = data.setdefault(key, {'date': day, 'talkgroup': talkgroup, 'files': {}})
        entry['files'][name] = status
        temp = path.with_suffix('.tmp')
        temp.write_text(json.dumps(data))
        temp.replace(path)
    except OSError:
        pass

MOUNTAIN = ZoneInfo('America/Denver')
GAP_SECONDS = DEFAULT_PAUSE_MS / 1000
DEFAULT_BATCH_SIZE = 300
MAX_AUDIO_BYTES = 20 * 1024 * 1024
MAX_CALLS = 5000
MEDIA_HOSTS = {'media.openmhz.com', 'media2.openmhz.com'}
SCHEMA_VERSION = 1
from radio_config import TALKGROUPS


def write_json(path, data):
    path.write_text(json.dumps(data, indent=2) + '\n')


def archive_readme(data):
    label = 'AFPD Car-to-Car' if data['talkgroup'] == 6001 else TALKGROUPS[data['talkgroup']][1]
    note = ('Selective AFPD archive: known AFPD-channel radio IDs plus calls within 120 seconds.\n'
            'Radio IDs identify radios observed on AFPD channels, not confirmed officer identities.\n'
            if data.get('selection_summary') else '')
    rows_note = ('rows.json: source labels in chronological unique-audio order.\n'
                 if data['talkgroup'] != 6001 else '')
    return (note + f'OpenMHz {label} ({data["talkgroup"]}), {data["date"]}, America/Denver.\n'
            f'Metadata schema: {SCHEMA_VERSION}.\n'
            f'Coverage: {data["coverage"]}; collected through {data.get("collected_through_utc") or "unknown"}.\n'
            f'{data["count"]} unique audio files; {data["source_call_count"]} source call entries.\n'
            'Source: OpenMHz (https://openmhz.com/). Original audio bytes and filenames retained.\n'
            'calls.json: chronological call metadata, original source IDs/labels, timestamps and audio checks.\n'
            + rows_note +
            'validation.json: coverage and audio-validation results, plus preserved historical evidence.\n'
            'Unix timestamps determine Mountain times; original browser labels may use another timezone.\n')


def day_bounds(day):
    start = datetime.combine(date.fromisoformat(day), day_time.min, MOUNTAIN)
    return start, start + timedelta(days=1)


def normalize_call_metadata(call, day):
    result = dict(call)
    if not result.get('id'):
        result['id'] = parse_qs(urlparse(result.get('call_link', '')).query).get('call-id', [None])[0]
    validate_call(result, day)
    instant = datetime.fromtimestamp(result['epoch'], timezone.utc)
    result['timestamp_utc'] = instant.isoformat().replace('+00:00', 'Z')
    result['timestamp_mountain'] = instant.astimezone(MOUNTAIN).strftime('%Y-%m-%d %H:%M:%S')
    result['talkgroup_name'] = TALKGROUPS[result['talkgroup']][1]
    return result


def coverage_metadata(data, day):
    coverage = data.get('coverage') or 'unknown'
    if coverage not in ('complete', 'partial', 'unknown'):
        raise ValueError('Invalid coverage status')
    start, end = day_bounds(day)
    value = data.get('collected_through_utc')
    cutoff = datetime.fromisoformat(value.replace('Z', '+00:00')) if value else None
    if cutoff is not None and (cutoff.tzinfo is None or not start <= cutoff <= end):
        raise ValueError('Cutoff must include a timezone and be within the target day boundaries')
    if coverage == 'complete':
        if end > datetime.now(timezone.utc):
            raise ValueError('Cannot mark an unfinished day complete')
        if cutoff is not None and cutoff != end:
            raise ValueError('Complete coverage must extend to the exclusive end of the day')
        cutoff = end
    elif coverage == 'partial' and (cutoff is None or cutoff == end):
        raise ValueError('Partial coverage requires a cutoff within the target day')
    if cutoff is not None and cutoff > datetime.now(timezone.utc) + timedelta(minutes=5):
        raise ValueError('Cutoff cannot be in the future')
    return coverage, cutoff


def validate_call(call, day):
    epoch = call.get('epoch')
    seconds = call.get('displayed_seconds')
    filename = call.get('original_filename')
    talkgroup = call.get('talkgroup')
    if (not isinstance(epoch, int) or isinstance(epoch, bool)
            or not isinstance(seconds, (int, float)) or isinstance(seconds, bool)
            or not math.isfinite(seconds) or seconds < 0
            or talkgroup not in TALKGROUPS
            or not isinstance(call.get('id'), str) or not call['id']
            or filename != f'dcfems-{talkgroup}-{epoch}.m4a'):
        raise ValueError('Invalid call metadata or audio filename')
    if datetime.fromtimestamp(epoch, MOUNTAIN).date().isoformat() != day:
        raise ValueError('Call falls outside the Mountain date')
    media = urlparse(call.get('media_url', ''))
    if (media.scheme != 'https' or media.hostname not in MEDIA_HOSTS
            or media.username or media.password or media.port not in (None, 443)
            or media.path != f'/media/dcfems/{talkgroup}/{filename}' or media.fragment):
        raise ValueError('Unexpected media URL: only the exact OpenMHz audio path is allowed')


def validate_manifest(data):
    day = data.get('date', '')
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', day):
        raise ValueError('Invalid date')
    date.fromisoformat(day)
    _, cutoff = coverage_metadata(data, day)
    calls = data.get('calls')
    if (data.get('timezone') != 'America/Denver' or data.get('system') != 'dcfems'
            or data.get('talkgroup') not in TALKGROUPS
            or not isinstance(calls, list) or not 0 < len(calls) <= MAX_CALLS
            or data.get('count') != len(calls)):
        raise ValueError('Invalid source manifest')
    ids = set()
    for call in calls:
        validate_call(call, day)
        if call['talkgroup'] != data['talkgroup']:
            raise ValueError('Call talkgroup does not match manifest')
        if (call['id'] in ids or (cutoff is not None and call['epoch'] > cutoff.timestamp())
                or call['epoch'] > datetime.now(timezone.utc).timestamp() + 300):
            raise ValueError('Duplicate ID or call after the collection cutoff')
        ids.add(call['id'])
    return day


class NoRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError('Unexpected audio redirect; stopped for review')


class Downloader:
    """One request at a time, with a configurable pause after each attempt."""
    def __init__(self, pause_ms=DEFAULT_PAUSE_MS):
        self.pause_ms = valid_pause_ms(pause_ms)
        self.pause_seconds = self.pause_ms / 1000
        self.finished_at = None
        self.opener = urllib.request.build_opener(NoRedirects())

    def download(self, url, destination):
        if self.finished_at is not None:
            time.sleep(max(0, self.pause_seconds - (time.monotonic() - self.finished_at)))
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'afpd-tracker-archive/1.0'})
            with self.opener.open(req, timeout=20) as response:
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
    if not math.isfinite(duration) or duration <= 0:
        raise ValueError(f'Unexpected audio duration: {path.name}')
    matches = abs(duration - call['displayed_seconds']) <= 1
    # The source label is metadata, not a validation limit. For a mismatch,
    # require a complete, error-free decode of an audio stream and retain both
    # durations. Identity, existing checksums and M4A checks still apply.
    if not matches:
        subprocess.run(['ffmpeg', '-v', 'error', '-xerror', '-i', str(path),
                        '-map', '0:a:0', '-f', 'null', '-'],
                       capture_output=True, check=True, timeout=60)
    return {'size_bytes': len(content), 'sha256': digest, 'audio_duration_seconds': duration,
            'source_duration_matches': matches}


def import_manifest(root, source, downloader, *, pause_ms=DEFAULT_PAUSE_MS):
    pause_ms = valid_pause_ms(pause_ms)
    data = json.loads(source.read_text())
    day = validate_manifest(data)
    talkgroup = data['talkgroup']
    channel = TALKGROUPS[talkgroup][0]
    if source.name not in (f'{day}.json', f'{day}-{channel}.json'):
        raise ValueError('Source manifest name must match its date')
    destination = root / 'public/records/openmhz' / f'openmhz-afpd-{channel}-{day}'
    old = json.loads((destination / 'calls.json').read_text()) if (destination / 'calls.json').exists() else None
    if destination.exists() and old is None:
        # Metadata collection may create the folder before the first download.
        # Preserve its raw listing, but never adopt untracked audio or other files.
        if any(entry.name != 'openmhz-listing.json' or not entry.is_file()
               or entry.is_symlink() for entry in destination.iterdir()):
            raise ValueError('Existing archive folder has no manifest')
    if old and (old.get('date') != day or old.get('talkgroup') != talkgroup):
        raise ValueError('Existing archive identity does not match')
    merged = {call['original_filename']: dict(call) for call in (old or {}).get('calls', [])}
    ids = {call['id']: name for name, call in merged.items() if call.get('id')}
    downloaded = skipped = 0
    duplicates = list((old or {}).get('duplicate_source_calls', []))
    # Existing verified R2 objects retain their checks without downloading them.
    checked_audio = {name: audio_checks(call) for name, call in merged.items()
                     if stored_audio(call, destination.name)}
    failure_path = root / 'records-pending-review/openmhz-failures' / f'{day}-{channel}.json'
    previous_failures = json.loads(failure_path.read_text()) if failure_path.exists() else None
    outstanding = {c['id']: c for c in (previous_failures or {}).get('calls', [])}
    failures = []
    failed_names = {}
    # Only validated recordings are copied into the public archive.
    with tempfile.TemporaryDirectory(prefix='openmhz-manifest-') as temp:
        temp = Path(temp)
        for position, incoming in enumerate(sorted(data['calls'], key=lambda call: (call['epoch'], call['id'])), 1):
            name = incoming['original_filename']
            if incoming['id'] in ids and ids[incoming['id']] != name:
                raise ValueError('Source ID changed its audio filename')
            previous = merged.get(name)
            audio = destination / name
            if previous and (stored_audio(previous, destination.name) or audio.exists()):
                checked = (audio_checks(previous) if stored_audio(previous, destination.name)
                           else inspect_audio(audio, previous))
                checked_audio[name] = checked
                skipped += 1
                if not previous.get('id') or previous['id'] == incoming['id']:
                    merged[name] = {**previous, **incoming, **checked}
                    for field in ('audio_storage', 'transcript', 'transcript_original',
                                  'validated', 'note', 'needs_review'):
                        if field in previous:
                            merged[name][field] = previous[field]
                    ids[incoming['id']] = name
                elif not any(x.get('id') == incoming['id'] for x in duplicates):
                    duplicates.append(incoming)
                outstanding.pop(incoming['id'], None)
                print(f'{day} [{position}/{len(data["calls"])}] SKIP {name}', flush=True)
                record_status(day, talkgroup, name, 'downloaded')
                continue
            audio = temp / name
            call = dict(incoming)
            try:
                if name in failed_names:
                    raise ValueError(failed_names[name])
                is_new = not audio.exists()
                if is_new:
                    print(f'{day} [{position}/{len(data["calls"])}] FETCH {name}', flush=True)
                    downloader.download(incoming['media_url'], audio)
                call.update(inspect_audio(audio, call))
            except (OSError, ValueError, urllib.error.URLError, http.client.HTTPException,
                    subprocess.SubprocessError) as error:
                if name not in checked_audio:
                    audio.unlink(missing_ok=True)
                reason = f'{type(error).__name__}: {error}'
                failed_names[name] = reason
                failed = {**incoming, 'download_error': reason}
                outstanding[incoming['id']] = failed
                failures.append(failed)
                print(f'{day} [{position}/{len(data["calls"])}] FAILED {name}: {reason}', flush=True)
                record_status(day, talkgroup, name, 'failed')
                continue
            downloaded += int(is_new)
            outstanding.pop(incoming['id'], None)
            call.pop('download_error', None)
            call['audio_downloaded'] = True
            if 'media_url_status' in call:
                call['media_url_status'] = 'download_validated'
            print(f'{day} [{position}/{len(data["calls"])}] OK {name}', flush=True)
            record_status(day, talkgroup, name, 'downloaded')
            checked_audio[name] = {key: call[key] for key in ('size_bytes', 'sha256', 'audio_duration_seconds', 'source_duration_matches') if key in call}
            instant = datetime.fromtimestamp(call['epoch'], timezone.utc)
            call['timestamp_utc'] = instant.isoformat().replace('+00:00', 'Z')
            call['timestamp_mountain'] = instant.astimezone(MOUNTAIN).strftime('%Y-%m-%d %H:%M:%S')
            call['talkgroup_name'] = TALKGROUPS[talkgroup][1]
            if previous and previous.get('id') and previous['id'] != call['id']:
                duplicates.append(call)
            else:
                merged[name] = call
                ids[call['id']] = name
        if outstanding:
            failure_path.parent.mkdir(parents=True, exist_ok=True)
            retry = dict(data)
            retry.update(calls=sorted(outstanding.values(), key=lambda c: (c['epoch'], c['id'])),
                         count=len(outstanding), coverage='unknown', collected_through_utc=None)
            retry['retry_note'] = 'Not retried automatically. Copy this manifest into openmhz-manifests to explicitly retry these calls.'
            write_json(failure_path, retry)
        else:
            failure_path.unlink(missing_ok=True)
        if not merged:
            return {'date': day, 'count': 0, 'downloaded': 0, 'skipped_existing': skipped, 'failed': len(failures)}
        calls = []
        for name, entry in merged.items():
            call = normalize_call_metadata(entry, day)
            checked = checked_audio.get(name)
            if checked is None and (destination / name).exists():
                checked = inspect_audio(destination / name, call)
            if checked is not None:
                checked_audio[name] = checked
                call.update(checked)
                call['audio_downloaded'] = True
            calls.append(call)
        calls.sort(key=lambda call: (call['epoch'], call['id']))
        duplicates = [normalize_call_metadata(call, day) for call in duplicates]
        for duplicate in duplicates:
            checked = checked_audio.get(duplicate['original_filename'])
            if checked is not None:
                duplicate.update(checked)
                duplicate['audio_downloaded'] = True
        start = datetime.combine(date.fromisoformat(day), day_time.min, MOUNTAIN)
        result = dict(old or {})
        result.update(schema_version=SCHEMA_VERSION, date=day, timezone='America/Denver', system='dcfems', talkgroup=talkgroup,
                      count=len(calls), source_call_count=len(calls) + len(duplicates), calls=calls,
                      start_utc=start.astimezone(timezone.utc).isoformat().replace('+00:00', 'Z'),
                      end_utc_exclusive=(start + timedelta(days=1)).astimezone(timezone.utc).isoformat().replace('+00:00', 'Z'))
        incoming_coverage, incoming_cutoff = coverage_metadata(data, day)
        old_coverage, old_cutoff = coverage_metadata(old or {}, day)
        statuses = (incoming_coverage, old_coverage)
        result['coverage'] = next(status for status in ('complete', 'partial', 'unknown') if status in statuses)
        result['download_failure_count'] = len(outstanding)
        if outstanding:
            result['coverage'] = 'unknown'
            result['coverage_note'] = f'{len(outstanding)} calls remain unavailable; see the separate failure manifest.'
        elif result['coverage'] != old_coverage or (old or {}).get('download_failure_count'):
            result.pop('coverage_note', None)
        cutoffs = [value for value in (incoming_cutoff, old_cutoff) if value is not None]
        cutoff = max(cutoffs).astimezone(timezone.utc).isoformat().replace('+00:00', 'Z') if cutoffs else None
        result['collected_through_utc'] = cutoff
        if duplicates:
            result['duplicate_source_calls'] = duplicates
            result['source_call_count'] = len(calls) + len(duplicates)
        destination.mkdir(parents=True, exist_ok=True)
        for audio in temp.glob('*.m4a'):
            shutil.copyfile(audio, destination / audio.name)
        for field in ('selection_summary', 'source_boundaries'):
            if field in data:
                result[field] = data[field]
        if 'source_inventory' in data:
            write_json(destination / 'source-inventory.json', data['source_inventory'])
        if 'selection_summary' in data:
            write_json(destination / 'selection-summary.json', data['selection_summary'])
        write_json(destination / 'calls.json', result)
        if talkgroup != 6001:
            write_json(destination / 'rows.json', [call.get('row', '') for call in calls])
        validation_path = destination / 'validation.json'
        validation = json.loads(validation_path.read_text()) if validation_path.exists() else {}
        validation.update(schema_version=SCHEMA_VERSION, date=day, timezone='America/Denver', system='dcfems',
                   talkgroup=talkgroup, count=len(calls), source_call_count=result['source_call_count'], downloaded=downloaded,
                   skipped_existing=skipped, validated=len(checked_audio) == len(calls),
                   audio_validated_count=len(checked_audio), audio_pending_count=len(calls) - len(checked_audio),
                   coverage=result['coverage'],
                   collected_through_utc=cutoff, minimum_pause_after_download_seconds=pause_ms / 1000)
        validation['source_duration_discrepancies'] = [call['original_filename'] for call in calls
                                                      if not call.get('source_duration_matches', True)]
        if result.get('coverage_note'):
            validation['coverage_note'] = result['coverage_note']
        else:
            validation.pop('coverage_note', None)
        write_json(validation_path, validation)
        (destination / 'README.txt').write_text(archive_readme(result))
    return {'date': day, 'count': len(calls), 'downloaded': downloaded, 'skipped_existing': skipped, 'failed': len(failures)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path.cwd())
    parser.add_argument('--summary', type=Path, required=True)
    parser.add_argument('--batch-size', type=int, default=DEFAULT_BATCH_SIZE)
    parser.add_argument('--pause-ms', type=valid_pause_ms, default=DEFAULT_PAUSE_MS,
                        help='Pause after each source download attempt in milliseconds (default: 1000)')
    parser.add_argument('--manifest', help='Process only this queued manifest filename')
    args = parser.parse_args()
    root = args.root.resolve()
    pending = sorted((root / 'records-pending-review/openmhz-manifests').glob('*.json'))
    if args.manifest:
        if not re.fullmatch(r'\d{4}-\d{2}-\d{2}(?:-car-to-car|-law-2|-6036)?\.json', args.manifest):
            parser.error('--manifest must be a dated queue filename')
        pending = [source for source in pending if source.name == args.manifest]
    for source in pending:
        validate_manifest(json.loads(source.read_text()))
    downloader = Downloader(pause_ms=args.pause_ms)
    if not 1 <= args.batch_size <= MAX_CALLS:
        parser.error('--batch-size must be between 1 and 5000')
    results = []
    remaining_budget = args.batch_size
    for source in pending:
        if remaining_budget == 0:
            break
        full = json.loads(source.read_text())
        ordered = sorted(full['calls'], key=lambda c: (c['epoch'], c['id']))
        selected, remaining = ordered[:remaining_budget], ordered[remaining_budget:]
        batch = {**full, 'calls': selected, 'count': len(selected)}
        if remaining:
            batch.update(coverage='unknown', collected_through_utc=None)
        # Keep the committed source queue intact until this batch has validated.
        with tempfile.TemporaryDirectory(prefix='openmhz-batch-') as directory:
            batch_source = Path(directory) / source.name
            write_json(batch_source, batch)
            results.append(import_manifest(root, batch_source, downloader, pause_ms=args.pause_ms))
        if remaining:
            write_json(source, {**full, 'calls': remaining, 'count': len(remaining)})
        else:
            source.unlink()
        remaining_budget -= len(selected)
    if results:
        subprocess.run(['node', '--input-type=module', '-e',
                        "import { buildRadioIndex } from './lib/build-radio-index.js'; buildRadioIndex();"], cwd=root, check=True)
    write_json(args.summary, results)
    print(json.dumps(results, indent=2))


if __name__ == '__main__':
    main()
