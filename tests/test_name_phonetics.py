import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from match_radio_names import normalize_ipa, rank
from build_radio_name_phonetics import INDEX_CATEGORIES


class NamePhoneticsTests(unittest.TestCase):
    def test_stress_length_and_rhotic_conventions_match(self):
        self.assertEqual(normalize_ipa('ˈɑː n | ð ə ɹ ʌ n'), 'ɑnðərʌn')
        self.assertEqual(normalize_ipa('ɚ ɡ'), 'ərg')
        self.assertEqual(normalize_ipa('ˈˌːˑ'), '')

    def test_exact_sound_match_does_not_merge_ramp_and_business(self):
        index = {'entries': [
            {'id': 'ramp', 'name': 'on-ramp', 'source_ids': [], 'forms': [{'text': 'on-ramp', 'ipa': 'ɑ n ɹ æ m p'}]},
            {'id': 'store', 'name': 'On the Run', 'source_ids': [], 'forms': [{'text': 'On the Run', 'ipa': 'ɑ n ð ə ɹ ʌ n'}]},
        ]}
        self.assertEqual(rank(index, 'ɑː n ð ə ɹ ʌ n')[0]['id'], 'store')
        self.assertEqual(rank(index, 'ɑ n ɹ æ m p')[0]['id'], 'ramp')
        self.assertNotIn('probability', rank(index, 'ɑ n ɹ æ m p')[0])
        with self.assertRaises(ValueError):
            rank(index, '| ˈ')

    def test_generated_index_has_every_place_and_person_and_resolvable_sources(self):
        catalog = json.loads((ROOT / 'transcription-helpers/reference-catalog.json').read_text())
        index = json.loads((ROOT / 'transcription-helpers/name-phonetics.json').read_text())
        expected = {e['id'] for e in catalog['entries'] if e['category'] in INDEX_CATEGORIES}
        self.assertEqual(expected, {e['id'] for e in index['entries']})
        self.assertEqual(len(expected), len(index['entries']))
        for entry in index['entries']:
            self.assertTrue(entry['source_ids'])
            for source in entry['source_ids']:
                self.assertIn(source, index['sources'])
            self.assertTrue(all(form['ipa'].strip() and 'unverified' in form['pronunciation_status'] for form in entry['forms']))

    def test_shared_names_and_nicknames_preserve_separate_people(self):
        index = json.loads((ROOT / 'transcription-helpers/name-phonetics.json').read_text())
        people = {'entries': [e for e in index['entries'] if e['entity_kind'] == 'person']}
        halladay = next(e for e in people['entries'] if e['id'] == 'officer-sammantha-j-halladay')
        sam = next(f for f in halladay['forms'] if f['text'] == 'Sam')
        matches = rank(people, sam['ipa'], 2)
        self.assertEqual({e['id'] for e in matches}, {'officer-sammantha-j-halladay', 'officer-samuel-canizalez'})
        self.assertEqual([e['similarity_score'] for e in matches], [1.0, 1.0])
        tball = next(e for e in people['entries'] if e['id'] == 'officer-tanner-m-ballamis')
        self.assertNotIn('D-Ball', [f['text'] for f in tball['forms']])
        self.assertNotIn('B-Ball', [f['text'] for f in tball['forms']])
        self.assertIn('owner_confirmed', next(f for f in tball['forms'] if f['text'] == 'G-Ball')['nickname_status'])

    def test_asr_errors_are_not_pronounced_as_aliases(self):
        index = json.loads((ROOT / 'transcription-helpers/name-phonetics.json').read_text())
        art = next(e for e in index['entries'] if e['id'] == 'park-mary-and-art-dye-park')
        self.assertNotIn('an art die', [f['text'] for f in art['forms']])
        store = next(e for e in index['entries'] if e['id'] == 'business-on-the-run')
        self.assertIn('unverified', store['notes'])
        self.assertEqual(len(store['locations']), 2)


if __name__ == '__main__':
    unittest.main()
