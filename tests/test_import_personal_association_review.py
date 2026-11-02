import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))

spec = importlib.util.spec_from_file_location('personal_import', Path(__file__).resolve().parents[1] / 'scripts/import_personal_association_review.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class PersonalReviewImportTests(unittest.TestCase):
    def fixture(self, root, second=None):
        officer = 'brandon-k-mason'
        (root/'data').mkdir()
        folder = root/'public/records/openmhz/openmhz-afpd-car-to-car-2026-10-28'
        folder.mkdir(parents=True)
        calls = [{'epoch': 100+i, 'original_filename': f'dcfems-6001-{100+i}.m4a', 'transcript': t, 'original_transcript': 'earliest'} for i,t in enumerate(['Old cue','Where at?'])]
        manifest = folder/'calls.json'
        manifest.write_text(json.dumps({'date':'2026-10-28','talkgroup':6001,'calls':calls}))
        (root/'data/officer-association-evidence.json').write_text(json.dumps({'schema_version':1,'officers':{officer:{'name':'Brandon K. Mason'}},'associations':[]}))
        exchange = {'exchange_id':'one','date':'2026-10-28','talkgroup':6001,'target_radio_id':'14590315','evidence_clips':[1,2],'required_reply_clips':[2],'reason':'Name cue and reply'}
        (root/'data/association-dialogue-review.json').write_text(json.dumps({'people':{officer:{'exchanges':[exchange],'unresolved':[]}}}))
        clip_id = '6001:2026-10-28:dcfems-6001-100.m4a'
        rows = [{'officer_id':officer,'clip_id':clip_id,'date':'2026-10-28','talkgroup':6001,'number':1,'evidence_selected':True}]
        changes=[]
        if second is not None:
            cid='6001:2026-10-28:dcfems-6001-101.m4a'
            rows.append({'officer_id':officer,'clip_id':cid,'date':'2026-10-28','talkgroup':6001,'number':2,'evidence_selected':False})
            changes=[{'officer_id':officer,'clip_id':cid,'included':False,**second}]
        export = {'reviewer':'Eric Seamons','exported_at':'export-time','clip_reviews':rows,'evidence_changes':changes,
                  'transcript_changes':[{'clip_id':clip_id,'text':'Mason, set up a landing zone.','current_source_transcript':'Old cue','original_transcript':'Old cue','edited_at':'edit-time','edited_by':'Eric Seamons'}]}
        path=root/'review.json';path.write_text(json.dumps(export))
        return path,manifest,officer

    def test_correction_preserves_originals_verifies_only_edited_clip_and_adds_targeted_reply(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);path,manifest,officer=self.fixture(root)
            result=module.import_review(path,root,officer)
            calls=json.loads(manifest.read_text())['calls']
            self.assertEqual(calls[0]['transcript'],'Mason, set up a landing zone.')
            self.assertTrue(calls[0]['validated']);self.assertEqual(calls[0]['original_transcript'],'earliest')
            self.assertEqual(calls[0]['original_transcript'],'earliest');self.assertNotIn('validated',calls[1])
            self.assertEqual(result['counts']['selected_evidence_clips'],2)
            source=json.loads((root/'data/officer-association-evidence.json').read_text())
            self.assertEqual(source['associations'][0]['radio_id'],'14590315')
            self.assertEqual(source['associations'][0]['clips'],[1,2])
            self.assertFalse(source['associations'][0]['personal_identity_confirmation'])
            module.import_review(path,root,officer)
            self.assertEqual(len(json.loads((root/'data/officer-association-evidence.json').read_text())['associations']),1)

    def test_explicit_uncheck_is_preserved_but_automatic_policy_uncheck_recovers(self):
        for synthetic,expected in [(False,1),(True,2)]:
            with self.subTest(synthetic=synthetic), tempfile.TemporaryDirectory() as tmp:
                root=Path(tmp)
                second={'policy_migration':'old cleanup','previous_choice':{'included':True}} if synthetic else {}
                path,_,officer=self.fixture(root,second)
                result=module.import_review(path,root,officer)
                self.assertEqual(result['counts']['selected_evidence_clips'],expected)
                self.assertEqual(result['counts']['recovered_selections'],int(synthetic))

    def test_conflicting_current_transcript_stops_without_writing(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);path,manifest,officer=self.fixture(root)
            data=json.loads(manifest.read_text());data['calls'][0]['transcript']='Another edit';manifest.write_text(json.dumps(data))
            before=manifest.read_bytes();source=(root/'data/officer-association-evidence.json').read_bytes()
            with self.assertRaisesRegex(ValueError,'changed since export'):
                module.import_review(path,root,officer)
            self.assertEqual(manifest.read_bytes(),before)
            self.assertEqual((root/'data/officer-association-evidence.json').read_bytes(),source)

if __name__ == '__main__':
    unittest.main()
