#!/usr/bin/env python3
"""Rank sourced place and person candidates from IPA or a textual ASR guess; never edit transcripts."""
import argparse
import json
from pathlib import Path
import unicodedata
from build_radio_name_phonetics import INDEX, phonemize_texts


def normalize_ipa(value):
    # Compare rhotic conventions and ignore stress, length and word separators.
    value = unicodedata.normalize('NFD', value.lower())
    for old, new in [('ɚ', 'ər'), ('ɝ', 'ɜr'), ('ɹ', 'r'), ('ɻ', 'r'), ('ɡ', 'g')]:
        value = value.replace(old, new)
    return ''.join(c for c in value if c not in 'ˈˌːˑ' and c.isalpha()
                   and not unicodedata.combining(c))


def substitution(a, b):
    if a == b:
        return 0
    # A modest tolerance for common vowel/rhotic conventions, not missing words.
    return 0.5 if any(a in group and b in group for group in ['ɑɒɔa', 'əʌɜ', 'ɪie', 'ʊu']) else 1


def distance(a, b):
    previous = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        current = [i]
        for j, y in enumerate(b, 1):
            current.append(min(current[-1] + 1, previous[j] + 1,
                               previous[j - 1] + substitution(x, y)))
        previous = current
    return previous[-1]


def rank(index, query, limit=5):
    normalized = normalize_ipa(query)
    if not normalized:
        raise ValueError('Provide a nonempty phonetic span, without surrounding sentence words')
    results = []
    for entry in index['entries']:
        candidates = []
        for form in entry['forms']:
            candidate = normalize_ipa(form['ipa'])
            if not candidate:
                continue
            cost = distance(normalized, candidate)
            candidates.append((1 - cost / max(len(normalized), len(candidate)), cost, form))
        if not candidates:
            continue
        score, cost, form = max(candidates, key=lambda x: (x[0], -x[1]))
        results.append({'id': entry['id'], 'name': entry['name'], 'entity_kind': entry.get('entity_kind', 'place'),
                        'matched_form': form['text'], 'ipa': form['ipa'],
                        'similarity_score': round(score, 4), 'edit_cost': cost,
                        'source_ids': entry['source_ids'],
                        'notes': entry.get('notes', ''),
                        'reference_status': entry.get('status', 'unspecified'),
                        'nickname_status': form.get('nickname_status'),
                        'form_notes': entry.get('spoken_form_notes', {}).get(form['text'], ''),
                        'local_pronunciation_verified': False})
    return sorted(results, key=lambda x: (-x['similarity_score'], x['edit_cost'], x['id']))[:limit]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument('--phonemes', help='IPA from an independent audio decoder, e.g. "ɑː n ɚ ɹ ə n"')
    source.add_argument('--text', help='Word guess converted to IPA; this is not independent audio evidence')
    parser.add_argument('--index', type=Path, default=INDEX)
    parser.add_argument('--limit', type=int, default=5)
    parser.add_argument('--candidate-id', action='append', default=[],
                        help='Explicitly restrict to a context-based shortlist; repeat for each ID')
    parser.add_argument('--kind', choices=['all', 'place', 'person'], default='all',
                        help='Limit the search to places or people, retaining ambiguous matches')
    args = parser.parse_args()
    if not 1 <= args.limit <= 50:
        parser.error('--limit must be between 1 and 50')
    try:
        query = args.phonemes if args.phonemes is not None else phonemize_texts([args.text])[0]
        index = json.loads(args.index.read_text())
        if args.kind != 'all':
            index['entries'] = [e for e in index['entries'] if e['entity_kind'] == args.kind]
        if args.candidate_id:
            known = {e['id'] for e in index['entries']}
            unknown = set(args.candidate_id) - known
            if unknown:
                raise ValueError('Unknown candidate IDs: ' + ', '.join(sorted(unknown)))
            index['entries'] = [e for e in index['entries'] if e['id'] in args.candidate_id]
        result = rank(index, query, args.limit)
    except (ValueError, ImportError) as exc:
        parser.error(str(exc))
    print(json.dumps({'input_kind': 'independent_phoneme_candidate' if args.phonemes is not None else 'text_guess',
                      'query_ipa': query, 'kind': args.kind, 'candidate_scope': args.candidate_id or 'all indexed entries',
                      'warning': 'Similarity is not probability or proof. Compare audio and context; retain uncertainty.',
                      'candidates': result}, indent=2, ensure_ascii=False))


if __name__ == '__main__':
    main()
