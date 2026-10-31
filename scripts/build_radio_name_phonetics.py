#!/usr/bin/env python3
"""Build a review-only place and person pronunciation index from the sourced catalog."""
import argparse
import importlib.metadata
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / 'transcription-helpers/reference-catalog.json'
INDEX = ROOT / 'transcription-helpers/name-phonetics.json'
PLACE_CATEGORIES = {'park', 'apartments', 'business', 'named_street', 'transport', 'road_feature', 'civic', 'school', 'landmark'}

NAME_CATEGORIES = {'officer', 'person'}
INDEX_CATEGORIES = PLACE_CATEGORIES | NAME_CATEGORIES


def phonemize_texts(texts):
    # Optional build/text-query dependency, never imported for IPA-only lookup.
    import espeakng_loader
    from phonemizer import phonemize
    from phonemizer.backend.espeak.wrapper import EspeakWrapper
    from phonemizer.separator import Separator
    os.environ['ESPEAK_DATA_PATH'] = espeakng_loader.get_data_path()
    EspeakWrapper.set_library(espeakng_loader.get_library_path())
    return phonemize(texts, language='en-us', backend='espeak', strip=True,
                     separator=Separator(phone=' ', word=' | ', syllable=''),
                     preserve_punctuation=False, with_stress=False, njobs=1)


def build(catalog):
    entries = [e for e in catalog['entries'] if e['category'] in INDEX_CATEGORIES]
    forms = [list(dict.fromkeys([e['name'], *e.get('spoken_forms', [])])) for e in entries]
    all_forms = [f for group in forms for f in group]
    ipa = iter(phonemize_texts(all_forms))
    result = []
    for entry, group in zip(entries, forms):
        row = {k: entry[k] for k in ('id', 'category', 'name', 'source_ids', 'status')}
        for key in ('notes', 'locations', 'address', 'spoken_form_notes', 'observed_asr_forms', 'nickname_candidates', 'radio_id_evidence', 'radio_ids', 'confirmed_dates', 'speaker_identity_confirmed_for_every_clip', 'historical_reference'):
            if key in entry:
                row[key] = entry[key]
        row['entity_kind'] = 'person' if entry['category'] in NAME_CATEGORIES else 'place'
        row['forms'] = [{'text': form, 'ipa': next(ipa), 'reference_status': entry['status'], 'pronunciation_status': 'machine_generated_local_pronunciation_unverified'} for form in group]
        for form in row['forms']:
            for nickname in entry.get('nickname_candidates', []):
                if nickname['form'] == form['text']:
                    form['nickname_status'] = nickname['status']
        result.append(row)
    return {'schema_version': 1, 'source_catalog': 'transcription-helpers/reference-catalog.json',
            'purpose': 'Candidate lookup only; scores are not probabilities. No transcript writes.',
            'pronunciation_engine': {'engine': 'espeak-ng', 'voice': 'en-us',
                                     'phonemizer_version': importlib.metadata.version('phonemizer'),
                                     'espeakng_loader_version': importlib.metadata.version('espeakng-loader')},
            'coverage_notes': catalog.get('coverage_notes', {}),
            'sources': catalog['sources'], 'entries': result}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--catalog', type=Path, default=CATALOG)
    parser.add_argument('--output', type=Path, default=INDEX)
    args = parser.parse_args()
    data = build(json.loads(args.catalog.read_text()))
    args.output.write_text(json.dumps(data, indent=2, ensure_ascii=False) + '\n')
    print(f"Built {len(data['entries'])} entries / {sum(len(e['forms']) for e in data['entries'])} spoken forms.")


if __name__ == '__main__':
    main()
