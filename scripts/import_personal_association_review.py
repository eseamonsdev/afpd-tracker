#!/usr/bin/env python3
"""Import one officer's evidence selections and explicitly corrected transcripts by stable recording ID."""
import argparse
import hashlib
import json
from pathlib import Path


def import_review(export_file, root, officer_id):
    export_file, root = Path(export_file), Path(root)
    raw = export_file.read_bytes()
    data = json.loads(raw)
    digest = hashlib.sha256(raw).hexdigest()
    reviewer = data.get('reviewer', '').strip()
    if not reviewer:
        raise ValueError('Review export must identify the reviewer')
    provenance = {'filename': export_file.name, 'sha256': digest, 'exported_at': data['exported_at'], 'reviewer': reviewer}
    source_path = root / 'data/officer-association-evidence.json'
    dialogue_path = root / 'data/association-dialogue-review.json'
    source = json.loads(source_path.read_text())
    dialogue = json.loads(dialogue_path.read_text())
    person_review = dialogue['people'][officer_id]
    manifests = {}

    def manifest(talkgroup, date):
        key = (talkgroup, date)
        if key not in manifests:
            folders = {6001: 'car-to-car', 5922: 'law-2'}
            if talkgroup not in folders:
                raise ValueError('Unsupported talkgroup')
            path = root / f'public/records/openmhz/openmhz-afpd-{folders[talkgroup]}-{date}/calls.json'
            content = json.loads(path.read_text())
            if content['talkgroup'] != talkgroup or content['date'] != date:
                raise ValueError('Manifest identity mismatch')
            manifests[key] = (path, content, sorted(content['calls'], key=lambda c: c['epoch']))
        return manifests[key]

    def resolve(clip_id):
        tg, date, filename = clip_id.split(':', 2)
        tg = int(tg)
        calls = manifest(tg, date)[2]
        matches = [(i + 1, c) for i, c in enumerate(calls) if c['original_filename'] == filename]
        if len(matches) != 1:
            raise ValueError(f'Unknown or duplicate recording: {clip_id}')
        number, call = matches[0]
        return tg, date, number, call

    # Plan and validate every transcript edit before changing anything on disk.
    corrections = []
    changed_manifests = set()
    for change in data.get('transcript_changes', []):
        tg, date, number, call = resolve(change['clip_id'])
        if not isinstance(change.get('text'), str):
            raise ValueError('Transcript correction must be text')
        current = call.get('transcript', '')
        baseline = change['current_source_transcript']
        if current not in (baseline, change['text']):
            raise ValueError(f'Transcript changed since export: {change["clip_id"]}')
        if change['text'] == baseline:
            continue
        call.setdefault('transcript_original', current)
        call.setdefault('original_transcript', call['transcript_original'])
        call['transcript'] = change['text']
        call['validated'] = True
        call['validated_by'] = change.get('edited_by') or reviewer
        call['validated_at'] = change['edited_at']
        call['transcript_review'] = {**provenance, 'edited_at': change['edited_at'], 'previous_transcript': baseline, 'method': 'owner_corrected_review_export'}
        corrections.append({**change, 'date': date, 'talkgroup': tg, 'number': number, 'validated': True})
        changed_manifests.add((tg, date))

    changes = {(r['officer_id'], r['clip_id']): r for r in data.get('evidence_changes', [])}
    selections, recovered = [], []
    for row in data['clip_reviews']:
        if row['officer_id'] != officer_id:
            continue
        tg, date, number, call = resolve(row['clip_id'])
        if (tg, date, number) != (row['talkgroup'], row['date'], row['number']):
            raise ValueError(f'Clip-number mismatch: {row["clip_id"]}')
        change = changes.get((officer_id, row['clip_id']))
        included = row['evidence_selected']
        recovery = change and change.get('policy_migration') and change.get('previous_choice', {}).get('included') is True
        if recovery:
            included = True
            recovered.append({'clip_id': row['clip_id'], 'date': date, 'number': number, 'previous_choice': change['previous_choice']})
        selections.append({'officer_id': officer_id, 'clip_id': row['clip_id'], 'talkgroup': tg, 'date': date, 'number': number, 'included': included, 'recovered_prior_choice': bool(recovery)})

    # Include an identified response missing from the old context window, never an explicitly unchecked clip.
    existing_ids = {r['clip_id'] for r in selections}
    for exchange in person_review['exchanges']:
        if not any(r['included'] and r['date'] == exchange['date'] and r['talkgroup'] == exchange['talkgroup'] and r['number'] in exchange['evidence_clips'] for r in selections):
            continue
        for number in exchange.get('required_reply_clips', []):
            call = manifest(exchange['talkgroup'], exchange['date'])[2][number - 1]
            clip_id = f'{exchange["talkgroup"]}:{exchange["date"]}:{call["original_filename"]}'
            if clip_id not in existing_ids:
                selections.append({'officer_id': officer_id, 'clip_id': clip_id, 'talkgroup': exchange['talkgroup'], 'date': exchange['date'], 'number': number, 'included': True, 'added_identifying_reply': True})
                existing_ids.add(clip_id)

    grouped, unresolved = {}, []
    for row in selections:
        exchanges = [e for e in person_review['exchanges'] if e['date'] == row['date'] and e['talkgroup'] == row['talkgroup'] and row['number'] in e['evidence_clips']]
        row['evidence_radio_ids'] = sorted({e['target_radio_id'] for e in exchanges})
        row['exchange_ids'] = [e['exchange_id'] for e in exchanges]
        if not row['included']:
            continue
        if not exchanges:
            unresolved.append(row)
            continue
        for radio in row['evidence_radio_ids']:
            key = (row['date'], row['talkgroup'], radio)
            entry = grouped.setdefault(key, {'clips': [], 'clip_ids': [], 'exchanges': {}})
            entry['clips'].append(row['number'])
            entry['clip_ids'].append(row['clip_id'])
            for exchange in exchanges:
                if exchange['target_radio_id'] == radio:
                    entry['exchanges'][exchange['exchange_id']] = exchange

    prefix = f'owner-export-{digest[:12]}-{officer_id}-'
    source['associations'] = [r for r in source['associations'] if not r.get('record_id', '').startswith(prefix)]
    records = []
    for (date, tg, radio), group in sorted(grouped.items()):
        record = {'record_id': f'{prefix}{date}-{tg}-{radio}', 'officer_id': officer_id, 'radio_id': radio, 'date': date, 'talkgroup': tg,
                  'clips': sorted(set(group['clips'])), 'status': 'supporting', 'confirmed_by': None, 'source': 'owner_evidence_selection',
                  'review_status': 'owner_reviewed_evidence', 'reviewed_by': reviewer, 'reviewed_at': data['exported_at'], 'name_heard': 'Mason',
                  'evidence': f'{reviewer} selected these calls as evidence for {source["officers"][officer_id]["name"]} and radio {radio}. ' + ' '.join(e['reason'] for e in group['exchanges'].values()),
                  'dialogue_exchange_ids': list(group['exchanges']), 'evidence_clip_ids': group['clip_ids'], 'provenance': provenance,
                  'personal_identity_confirmation': False}
        source['associations'].append(record)
        records.append(record)

    active_ids = [r['record_id'] for r in records]
    for record in source['associations']:
        if record['officer_id'] != officer_id:
            continue
        group = grouped.get((record['date'], record['talkgroup'], record['radio_id']))
        if group and set(record.get('clips', [])) & set(group['clips']):
            active_ids.append(record['record_id'])
    source.setdefault('owner_evidence_reviews', {})[officer_id] = {**provenance, 'active_record_ids': sorted(set(active_ids)), 'notice': 'Other original rows are retained as historical context, not active evidence or counted days.'}
    person_review['owner_review'] = {**provenance, 'clip_selections': selections, 'recovered_selections': recovered, 'unassigned_selected_clips': unresolved,
                                   'notice': 'Evidence inclusion reviewed by owner. This is not a separate personally confirmed radio-identity assertion.'}
    audit = {**provenance, 'officer_id': officer_id, 'transcript_corrections': corrections, 'evidence_changes': data.get('evidence_changes', []),
             'clip_selections': selections, 'recovered_selections': recovered, 'association_record_ids': [r['record_id'] for r in records],
             'counts': {'corrected_transcripts': len(corrections), 'selected_evidence_clips': sum(r['included'] for r in selections), 'recovered_selections': len(recovered), 'radio_day_records': len(records), 'unassigned_selected_clips': len(unresolved)}}
    # All validation and attribution is complete before writing.
    for key in changed_manifests:
        path, content, _ = manifests[key]
        path.write_text(json.dumps(content, ensure_ascii=False, indent=2) + '\n')
    source_path.write_text(json.dumps(source, ensure_ascii=False, indent=2) + '\n')
    dialogue_path.write_text(json.dumps(dialogue, ensure_ascii=False, indent=2) + '\n')
    audit_dir = root / 'data/personal-association-review-imports'
    audit_dir.mkdir(exist_ok=True)
    (audit_dir / f'{digest[:16]}.json').write_text(json.dumps(audit, ensure_ascii=False, indent=2) + '\n')
    return audit


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('export_file')
    parser.add_argument('root', nargs='?', default='.')
    parser.add_argument('--officer', required=True)
    args = parser.parse_args()
    result = import_review(args.export_file, args.root, args.officer)
    print(json.dumps(result['counts'], indent=2))
