import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parents[1] / 'scripts'))
import backfill_transcript_originals as history
from transcript_versions import set_transcript


NAME='dcfems-6001-1792908038.m4a'
PATH='public/records/openmhz/openmhz-afpd-car-to-car-2026-10-25/calls.json'


def event(commit,path,blob):
    return {'commit':commit,'path':path,'blob':blob,'old_blob':'0'*40,'subject':'fixture','timestamp':1}


class HistoryTests(unittest.TestCase):
    def test_markdown_precedes_json_without_any_verification_flags(self):
        md=PATH.replace('calls.json','transcript.md')
        events=[event('old',md,'a'),event('new',PATH,'b')]
        blobs={'a':f'**999 · time** — [Audio](https://example.com/{NAME}) — Original [unclear].\n',
               'b':json.dumps({'calls':[{'original_filename':NAME,'transcript':'Corrected wording.'}]})}
        recovered,warnings=history.recover(events,blobs)
        self.assertEqual(recovered[NAME]['text'],'Original [unclear].')
        self.assertEqual(recovered[NAME]['commit'],'old')
        self.assertFalse(warnings)

    def test_earliest_json_wins_even_if_later_version_has_no_verified_field(self):
        events=[event('old',PATH,'a'),event('new',PATH,'b')]
        blobs={sha:json.dumps({'calls':[{'original_filename':NAME,'transcript':text}]})
               for sha,text in [('a','First automatic text.'),('b','Latest text.')]} 
        recovered,_=history.recover(events,blobs)
        self.assertEqual(recovered[NAME]['text'],'First automatic text.')

    def test_merge_only_transcript_is_included(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            def git(*args):
                return subprocess.check_output(['git',*args],cwd=root,stderr=subprocess.DEVNULL).decode().strip()
            git('init','-q','-b','base')
            git('config','user.email','fixture@example.com');git('config','user.name','Fixture')
            target=root/PATH;target.parent.mkdir(parents=True);target.write_text('{"calls":[]}')
            git('add','.');git('commit','-qm','initial audio metadata')
            git('switch','-qc','side');(root/'side.txt').write_text('side')
            git('add','.');git('commit','-qm','unrelated side change')
            git('switch','base');(root/'base.txt').write_text('base')
            git('add','.');git('commit','-qm','unrelated base change')
            git('merge','--no-commit','--no-ff','side')
            target.write_text(json.dumps({'calls':[{'original_filename':NAME,'transcript':'First merge text.'}]}))
            git('add','.');git('commit','-qm','add transcript in merge result')
            commit=git('rev-parse','HEAD')
            self.assertTrue(any(e['commit']==commit and e['path']==PATH for e in history.events(root,'HEAD')))

    def test_backfill_preserves_current_fields_and_refuses_changed_audio(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);target=root/PATH;target.parent.mkdir(parents=True)
            call={'id':'id','epoch':1792908038,'original_filename':NAME,'sha256':'a'*64,
                  'transcript':'Human correction.','validated':True,'note':'Keep me'}
            data={'date':'2026-10-25','calls':[call]};target.write_text(json.dumps(data))
            events=[event('first',PATH,'blob')]
            original=json.dumps({'calls':[{**call,'transcript':'Original AI text.','validated':False}]})
            with patch.object(history,'events',return_value=events), \
                 patch.object(history,'read_blobs',return_value={'blob':original}), \
                 patch.object(history,'git',return_value=b'head\n'):
                result=history.backfill(root,write=True)
                saved=json.loads(target.read_text())
                self.assertEqual(saved['calls'][0].pop('transcript_original'),'Original AI text.')
                self.assertEqual(saved,data)
                self.assertEqual(result['totals']['originals_added'],1)
                target.write_text(json.dumps(data))
                before=target.read_bytes()
                bad=json.dumps({'calls':[{**call,'sha256':'b'*64,'transcript':'Unrelated audio text.'}]})
                with patch.object(history,'read_blobs',return_value={'blob':bad}):
                    result=history.backfill(root,write=True)
                    self.assertEqual(result['totals']['unresolved'],1)
                    self.assertEqual(target.read_bytes(),before)


class VersionTests(unittest.TestCase):
    def test_original_is_written_once_and_user_corrections_remain_current(self):
        call={'transcript':'Original [unclear].','note':'Keep','validated':False}
        set_transcript(call,'First correction.',validated=True)
        set_transcript(call,'Latest correction.',validated=True)
        self.assertEqual(call,{'transcript':'Latest correction.','transcript_original':'Original [unclear].',
                               'validated':True,'note':'Keep'})

    def test_new_automated_publication_keeps_both_texts_without_marking_verified(self):
        call={}
        set_transcript(call,'[No intelligible speech]')
        self.assertEqual(call['transcript'],call['transcript_original'])
        self.assertNotIn('validated',call)


if __name__=='__main__':unittest.main()
