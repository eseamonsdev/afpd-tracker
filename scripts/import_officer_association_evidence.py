#!/usr/bin/env python3
"""Reproduce the initial, unfiltered union. Not a build step; do not rerun over later reviews."""
import copy
import datetime
import io
import json
from pathlib import Path
import re
import subprocess
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parents[1]
BEFORE = '7dd4b1a'
AFTER = 'd987462'
RECORDS = 'public/records/openmhz/'
NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}

def blob(ref, path):
    return subprocess.check_output(['git', 'show', f'{ref}:{path}'], cwd=ROOT)

def read(ref, path):
    return json.loads(blob(ref, path))

def workbook_rows(archive, number):
    rows = []
    for row in ET.fromstring(archive.read(f'xl/worksheets/sheet{number}.xml')).findall('.//m:row', NS):
        values = {}
        for cell in row:
            column = re.sub(r'\d', '', cell.get('r'))
            inline = cell.find('m:is', NS)
            value = cell.find('m:v', NS)
            values[column] = ''.join(inline.itertext()) if inline is not None else value.text if value is not None else ''
        rows.append(values)
    return rows

def day(serial):
    return (datetime.date(1899, 12, 30) + datetime.timedelta(days=int(float(serial)))).isoformat()

def slug(name):
    return re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')

source = read(AFTER, 'data/officer-association-evidence.json')
source.pop('review_mode', None)
source['migration_note'] = 'Historical union of workbook exchanges, exceptions, original table entries, and review findings. Retained candidates are archival evidence, not display approvals. Only individually accepted evidence contributes to general strength; owner-confirmed dates remain authoritative. The unfiltered review mode has been removed.'
source['import_sources'] = [{'ref': BEFORE, 'purpose': 'Pre-migration evidence and table'}, {'ref': AFTER, 'purpose': 'Migrated evidence including October 30 Halladay identification'}]
source['observations'] = []
source['legacy_resource_entries'] = []
source['legacy_workbook_findings'] = []
source['legacy_review_reports'] = []
profiles = source['officers']
# Use the expanded names already documented in this repository.
profiles['david-o-guerra']['name'] = 'David Octavio Guerra'

roster = {}
for file in (ROOT / 'data/entities/people/officers').glob('*.json'):
    for person in json.loads(file.read_text()).get('entities', []):
        name = person.get('name', '')
        if ', ' in name:
            last, first = name.split(', ', 1)
            roster[f'{first} {last}'] = file.stem
roster['Kyle B. Pitt'] = 'kyle-b-pitt'

aliases = {}
for key, profile in profiles.items():
    aliases[profile['name']] = key
    for name in profile.get('heard', '').split(' / '):
        aliases.setdefault(name, key)
# These are existing roster/workbook spellings, not new listening decisions.
for name, key in {'Neil': 'unresolved-neil', 'Heaton': 'colby-a-heaton', 'Colby': 'colby-a-heaton', 'Cole': 'cole-g-richardson', 'Mecham': 'greg-b-mecham', 'Brandon': 'brandon-k-mason', 'Josh': 'joshua-m-jensen', 'Ethan': 'ethan-c-simmons'}.items():
    aliases[name] = key

def identity(candidate, heard):
    candidate = re.sub(r'\s*\(candidate\)$', '', candidate)
    candidate = candidate.split(' — ')[0]
    if candidate == 'David O. Guerra':
        return 'david-o-guerra'
    if candidate and candidate not in {'Unresolved', 'Multiple candidates', 'Mckay or Philip Valadez'}:
        key = next((key for key, profile in profiles.items() if profile['name'] == candidate), None) or roster.get(candidate)
        if key:
            profiles.setdefault(key, {'name': 'Kyle Bradley Pitt' if key == 'kyle-b-pitt' else candidate, 'heard': heard, 'url': f'/officers/{key}/'})
            return key
    name = re.sub(r'\s*\(unclear\)', '', heard).strip(' ?') or 'Unnamed observation'
    key = 'unresolved-' + slug(name)
    profiles.setdefault(key, {'name': f'{name} (unresolved)', 'heard': heard, 'url': '', 'unresolved': True, 'original_candidate': candidate})
    return key

for number, record in enumerate(source['associations'], 1):
    record['record_id'] = f'prior-source-{number:03}'
    record['review_status'] = 'pending'
    record['name_heard'] = profiles[record['officer_id']]['heard']
    record['provenance'] = {'ref': AFTER, 'path': 'data/officer-association-evidence.json', 'record': number}

# Import both snapshots, preserving different versions if an exchange changed.
seen_workbooks = set()
for ref in [BEFORE, AFTER]:
    content = blob(ref, RECORDS + 'afpd-radio-id-response-days.xlsx')
    if content in seen_workbooks:
        continue
    seen_workbooks.add(content)
    workbook = zipfile.ZipFile(io.BytesIO(content))
    findings = [row for row in workbook_rows(workbook, 1) if re.fullmatch(r'[1-9]\d*', row.get('B', ''))]
    source['legacy_workbook_findings'].extend({'ref': ref, **row} for row in findings)
    exchange_candidates = {}
    for finding in findings:
        for evidence_id in finding.get('L', '').split(', '):
            exchange_candidates.setdefault(evidence_id, []).append(finding)
    for row in workbook_rows(workbook, 2):
        if not re.fullmatch(r'E\d+', row.get('A', '')):
            continue
        findings_for_row = exchange_candidates.get(row['A'], [])
        if not findings_for_row:
            findings_for_row = [r for r in findings if r['A'] == row['B'] and r['B'] == row['J']] or [{}]
        for candidate_number, finding in enumerate(findings_for_row, 1):
            key = identity(finding.get('I', ''), row['B'])
            profiles[key].setdefault('heard_variants', [])
            if row['B'] not in profiles[key]['heard_variants']:
                profiles[key]['heard_variants'].append(row['B'])
            notes = ' '.join(text for text in [row.get('N'), finding.get('J')] if text)
            source['associations'].append({'record_id': f'workbook-{row["A"]}-{candidate_number}', 'officer_id': key, 'radio_id': row['J'], 'date': day(row['C']), 'talkgroup': 6001, 'clips': [int(row['D']), int(row['G'])], 'name_heard': row['B'], 'evidence': f'{row["A"]}. Name heard: {row["B"]}. Question/comment: {row["K"]} Reply: {row["L"]}' + (f' Original notes: {notes}' if notes else ''), 'status': 'supporting', 'confirmed_by': None, 'review_status': 'pending', 'original_assessment': row['M'], 'original_candidate': finding.get('I', ''), 'conflicting_names': finding.get('H', ''), 'evidence_ids': [row['A']], 'provenance': {'ref': ref, 'path': RECORDS + 'afpd-radio-id-response-days.xlsx', 'sheet': 'Exchanges', 'evidence_id': row['A']}})
    for number, row in enumerate(workbook_rows(workbook, 3)[7:], 1):
        if not row.get('A') or not row['A'].replace('.', '', 1).isdigit():
            continue
        source['observations'].append({'record_id': f'workbook-exception-{number:02}', 'date': day(row['A']), 'talkgroup': 6001, 'clips': [int(row['B'])], 'evidence': f'Original comment: {row["C"]} Following transmissions: {row["D"]} Original reason excluded: {row["E"]}', 'original_assessment': 'Previously excluded observation; retained without reassessment', 'raw': row, 'review_status': 'pending', 'provenance': {'ref': ref, 'path': RECORDS + 'afpd-radio-id-response-days.xlsx', 'sheet': 'Exceptions', 'row': number + 7}})

# Preserve every old table row, its notes, and date-only fallback evidence.
for ref in [BEFORE, AFTER]:
    page = read(ref, 'data/entities/pages/police-radio-resources.json')['entities'][0]
    for officer in page['officers'].get('entries', []):
        if officer not in source['legacy_resource_entries']:
            source['legacy_resource_entries'].append(copy.deepcopy(officer))
        key = officer['url'].strip('/').split('/')[-1]
        profiles.setdefault(key, {k: officer[k] for k in ['name', 'heard', 'url']})
        for entry in officer['ids']:
            # Restore the two original Choates examples which were outside the workbook.
            if key == 'delton-l-choates' and entry['id'] == '14590045':
                for date, clips in [('2026-09-17', [254,255]), ('2026-10-11', [259,260])]:
                    if any(r['officer_id']==key and r['radio_id']==entry['id'] and r['date']==date for r in source['associations']):
                        continue
                    source['associations'].append({'record_id': f'legacy-choates-{date}', 'officer_id': key, 'radio_id': entry['id'], 'date': date, 'talkgroup': 6001, 'clips': clips, 'name_heard': officer['heard'], 'evidence': officer['note'], 'status': 'supporting', 'confirmed_by': None, 'review_status': 'pending', 'original_assessment': 'Uncertain name reading in original resource table', 'provenance': {'ref': ref, 'path': 'data/entities/pages/police-radio-resources.json'}})
    legacy = read(ref, RECORDS + 'officer-associations.json')
    if legacy['schema_version'] == 2:
        for entries in legacy['days'].values():
            for rid, entry in entries.items():
                key = next((key for key, profile in profiles.items() if profile['name'] == entry['name']), None)
                if entry['name'] == 'David O. Guerra': key = 'david-o-guerra'
                if not key: raise ValueError(entry['name'])
                for date in entry.get('evidence_dates', []):
                    if any(r['officer_id']==key and r['radio_id']==rid and r['date']==date for r in source['associations']): continue
                    source['associations'].append({'record_id': f'legacy-date-{key}-{rid}-{date}', 'officer_id': key, 'radio_id': rid, 'date': date, 'talkgroup': 6001, 'clips': [], 'name_heard': profiles[key]['heard'], 'evidence': f'Previous association data lists {date} as an evidence date for {entry["name"]} and radio {rid}. Clip numbers were not recorded in that entry. Retained without reassessment.', 'status': 'supporting', 'confirmed_by': None, 'review_status': 'pending', 'original_assessment': entry['status'], 'provenance': {'ref': ref, 'path': RECORDS + 'officer-associations.json'}})

seen_reports = set()
for ref in [BEFORE, AFTER]:
    report_path = 'findings/2026-10-27-radio-officer-label-review.json'
    content = blob(ref, report_path)
    if content in seen_reports: continue
    seen_reports.add(content)
    report = json.loads(content)
    source['legacy_review_reports'].append({'ref': ref, 'candidate_reviews': report['candidate_reviews'], 'held_associations': report['held_associations']})
    for number, row in enumerate(report['candidate_reviews'], 1):
        heard = row['hail'].strip(' ?')
        key = aliases.get(heard)
        if key and key not in profiles:
            name = next((name for name, slug in roster.items() if slug == key), None)
            if name: identity(name, heard)
            else: key = None
        key = key or identity('', heard)
        source['associations'].append({'record_id': f'legacy-review-{number:03}', 'officer_id': key, 'radio_id': row['id'], 'date': row['date'], 'talkgroup': 6001, 'clips': [row['q'], row['r']], 'name_heard': row['hail'], 'evidence': f'Original screened hail: {row["hail"]}. Original review decision: {row["decision"]}. Original explanation: {row["reason"]}. Retained for Eric to assess.', 'status': 'supporting', 'confirmed_by': None, 'review_status': 'pending', 'original_assessment': row['decision'], 'provenance': {'ref': ref, 'path': report_path, 'candidate_review': number}})

# Expand recorded ambiguous candidates without picking a winner. All candidates
# retain the same date, clips, source, uncertainty and shared candidate group.
expanded = []
for record in source['associations']:
    key = record['officer_id']
    heard = record.get('name_heard', '')
    candidate_names = []
    if key == 'unresolved-valadez' or record.get('original_candidate') == 'Mckay or Philip Valadez':
        candidate_names = ['Mckay A. Valadez', 'Philip E. Valadez']
    elif key == 'unresolved-sam':
        candidate_names = ['Sammantha J. Halladay', 'Samuel Canizalez']
    elif heard == 'Phil' or key == 'unresolved-phil':
        candidate_names = ['Philip E. Valadez', 'Philip W. S. Craig']
    elif key == 'unresolved-neil':
        candidate_names = ['Anthony S. Neil']
    elif key == 'unresolved-colton':
        candidate_names = ['Colton J. Rothe']
    elif key == 'unresolved-jake':
        candidate_names = ['Jake D. Laycock']
    elif key == 'unresolved-mitch':
        candidate_names = ['Mitchell R. Godfrey']
    if not candidate_names:
        expanded.append(record)
        continue
    candidate_ids = [identity(name, heard) for name in candidate_names]
    for candidate in candidate_ids:
        alternative = copy.deepcopy(record)
        alternative['officer_id'] = candidate
        alternative['candidate_group_id'] = record['record_id']
        alternative['record_id'] += '--' + candidate
        alternative['candidate_officer_ids'] = candidate_ids
        alternative['original_unresolved_identity'] = profiles[key] if profiles[key].get('unresolved') else None
        alternative['evidence'] += ' Retained roster candidates for review: ' + ', '.join(profiles[c]['name'] for c in candidate_ids) + '. No candidate was selected as the correct identity.'
        expanded.append(alternative)
source['associations'] = expanded

source['import_counts'] = {'workbook_exchange_ids': len({r['provenance']['evidence_id'] for r in source['associations'] if r['provenance'].get('sheet') == 'Exchanges'}), 'workbook_exceptions': len(source['observations']), 'candidate_reviews': sum(len(r['candidate_reviews']) for r in source['legacy_review_reports']), 'legacy_resource_entries': len(source['legacy_resource_entries']), 'previous_records': sum(r['record_id'].startswith('prior-source-') for r in source['associations'])}
(ROOT / 'data/officer-association-evidence.json').write_text(json.dumps(source, indent=2, ensure_ascii=False) + '\n')
print(json.dumps({'records': len(source['associations']), **source['import_counts']}, indent=2))
