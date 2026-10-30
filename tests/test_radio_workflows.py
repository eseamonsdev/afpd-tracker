import hashlib
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import call as mock_call, patch

sys.path.insert(0, str(Path(__file__).parents[1] / 'scripts'))
from prepare_radio_day import prepare
from radio_config import TALKGROUPS, archive_path, metadata_paths
from radio_workflow_request import requests, resolve
from publish_radio_status import snapshot
import transcribe_afpd_radio as core
import transcribe_radio_batches as transcription
import recover_verified_openmhz_audio as recovery
import run_radio_audio as audio_runner


DAY = '2026-10-02'
EPOCH = 1790920819


def call(talkgroup, offset=0):
    epoch = EPOCH + offset
    name = f'dcfems-{talkgroup}-{epoch}.m4a'
    return {'id': str(epoch), 'epoch': epoch, 'talkgroup': talkgroup,
            'original_filename': name, 'displayed_seconds': 1,
            'media_url': f'https://media2.openmhz.com/media/dcfems/{talkgroup}/{name}'}


def write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data))


class RequestTests(unittest.TestCase):
    def test_pause_parameter_defaults_overrides_and_validation(self):
        self.assertEqual(requests({'day': DAY})[0]['pause_ms'], 1000)
        rows = requests({'pause_ms': 500, 'requests': [{'day': DAY}, {'day': '2026-10-03', 'pause_ms': 0}]})
        self.assertEqual([r['pause_ms'] for r in rows], [500, 0])
        row = resolve(Path('/unused'), 'audio', {'INPUT_DAY': DAY, 'INPUT_PAUSE_MS': '750'})[0]
        self.assertEqual(row['pause_ms'], 750)
        for value in [-1, True, 'nan', 0.5]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                requests({'day': DAY, 'pause_ms': value})
    def test_default_and_every_branch_talkgroup_combination(self):
        self.assertEqual(requests({'day': DAY})[0]['target_branch'], 'staging')
        self.assertEqual(requests({'date': DAY})[0]['talkgroup'], 6001)
        for branch in ('staging',):
            for group in TALKGROUPS:
                with self.subTest(branch=branch, group=group):
                    self.assertEqual(requests({'day': DAY, 'talkgroup': str(group),
                                               'target_branch': branch})[0],
                                     {'day': DAY, 'talkgroup': group, 'target_branch': branch,
                                      'mode': 'download', 'proof': '', 'pause_ms': 1000})

    def test_days_are_independent_and_bad_inputs_rejected(self):
        rows = requests({'days': [DAY, '2026-10-20'], 'talkgroup': 5922})
        self.assertEqual([r['day'] for r in rows], [DAY, '2026-10-20'])
        for field, value in [('day', '20261002'), ('day', '../2026-10-02'),
                             ('talkgroup', 9999), ('target_branch', 'main'),
                             ('target_branch', 'law-2'),
                             ('proof', '../../secret'), ('mode', 'retry-everything')]:
            with self.subTest(field=field), self.assertRaises(ValueError):
                requests({'day': DAY, field: value})

    def test_legacy_transcription_request_and_scoped_manifest_push(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            event = root / 'event.json'
            write(event, {})
            env = {'GITHUB_EVENT_NAME': 'push', 'GITHUB_EVENT_PATH': str(event),
                   'GITHUB_REF_NAME': 'staging'}
            name = 'records-pending-review/openmhz-transcription-request.json'
            write(root / name, {'date': DAY, 'talkgroup': 6001, 'batch_size': 10})
            with patch('radio_workflow_request.changed_paths', return_value=[name]):
                self.assertEqual(resolve(root, 'transcribe', env)[0]['talkgroup'], 6001)
            name = f'records-pending-review/openmhz-manifests/{DAY}-6036.json'
            write(root / name, {'date': DAY, 'talkgroup': 6036})
            with patch('radio_workflow_request.changed_paths', return_value=[name]):
                rows = resolve(root, 'audio', env)
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0]['talkgroup'], 6036)

    def test_reusable_workflow_inputs_override_the_callers_push_event(self):
        rows = resolve(Path('/unused'), 'audio', {'GITHUB_EVENT_NAME': 'push',
                       'INPUT_DAY': DAY, 'INPUT_TALKGROUP': '5922', 'INPUT_BRANCH': 'staging'})
        self.assertEqual(rows[0]['talkgroup'], 5922)
        self.assertEqual(rows[0]['target_branch'], 'staging')


class AfpdSelectionTests(unittest.TestCase):
    def test_selection_skips_existing_and_verified_and_non_afpd_with_full_context(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            write(root / 'data/radio-agency-corrections.json', {'18': {'afpd': False}})
            write(root / 'public/records/openmhz/openmhz-afpd-car-to-car-2026-10-01/calls.json',
                  {'talkgroup': 6001, 'calls': [{'radio_ids': ['5', '18'], 'srcList': None}]})
            calls = [dict(call(5922, i * 10), radio_ids=[value])
                     for i, value in enumerate(['99', '5', '18', '5', '5'])]
            calls[3]['transcript'] = 'Existing user correction'
            calls[4]['validated'] = True
            data = {'talkgroup': 5922, 'calls': calls}
            with patch.object(transcription, 'ROOT', root):
                selected = transcription.selected_indices(data, 'afpd_missing')
            self.assertEqual(selected, [1])
            self.assertEqual(core.context_indices(calls, selected[0], core.read(core.SETTINGS)), [0])
            self.assertEqual(calls[3]['transcript'], 'Existing user correction')
            self.assertTrue(calls[4]['validated'])
            with self.assertRaises(ValueError):
                transcription.selected_indices({'talkgroup': 6001, 'calls': calls}, 'afpd_missing')

    def test_selection_reaches_each_request_and_rejects_invalid_scope(self):
        rows = requests({'days': [DAY, '2026-10-03'], 'talkgroup': 5922,
                         'selection': 'afpd_missing'})
        self.assertEqual([r['selection'] for r in rows], ['afpd_missing', 'afpd_missing'])
        for payload in ({'day': DAY, 'selection': 'afpd_missing'},
                        {'day': DAY, 'talkgroup': 5922, 'selection': 'unknown'}):
            with self.assertRaises(ValueError):
                requests(payload)


class PreparationTests(unittest.TestCase):
    def test_all_groups_skip_saved_and_failed_and_resume_only_selected_day(self):
        for group in TALKGROUPS:
            with self.subTest(group=group), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                calls = [call(group, i) for i in range(3)]
                data = {'date': DAY, 'talkgroup': group, 'count': 3, 'calls': calls}
                write(root / metadata_paths(DAY, group)[0], data)
                folder = archive_path(root, DAY, group)
                write(folder / 'calls.json', {'calls': calls[:1]})
                (folder / calls[0]['original_filename']).write_bytes(b'archived')
                channel = TALKGROUPS[group][0]
                write(root / f'records-pending-review/openmhz-failures/{DAY}-{channel}.json',
                      {'calls': calls[1:2]})
                result = prepare(root, DAY, group)
                self.assertEqual(result['queued'], 1)
                path = root / 'records-pending-review/openmhz-manifests' / result['manifest']
                self.assertEqual(json.loads(path.read_text())['calls'], calls[2:])
                self.assertTrue(prepare(root, DAY, group)['resuming'])

    def test_saved_metadata_can_be_fetched_from_staging_without_merging(self):
        data = {'date': DAY, 'talkgroup': 5922, 'count': 1, 'calls': [call(5922)]}
        commands = []
        def git(cmd, **kwargs):
            commands.append(cmd)
            found = cmd[:3] == ['git', 'show', f'origin/staging:{metadata_paths(DAY, 5922)[0].as_posix()}']
            return SimpleNamespace(returncode=0 if found or cmd[1]=='fetch' else 1,
                                   stdout=json.dumps(data) if found else '')
        with tempfile.TemporaryDirectory() as tmp, patch('prepare_radio_day.subprocess.run', side_effect=git):
            root = Path(tmp)
            self.assertEqual(prepare(root, DAY, 5922, fetch=True)['queued'], 1)
            self.assertTrue((root / metadata_paths(DAY, 5922)[0]).is_file())
        self.assertFalse(any('merge' in cmd for cmd in commands))
        self.assertFalse(any('law-2' == part or part.startswith('origin/law-2:') for cmd in commands for part in cmd))

    def test_wrong_pending_talkgroup_cannot_be_resumed(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            data = {'date': DAY, 'talkgroup': 6001, 'timezone': 'America/Denver',
                    'system': 'dcfems', 'count': 1, 'calls': [call(6001)]}
            write(root / f'records-pending-review/openmhz-manifests/{DAY}-law-2.json', data)
            with self.assertRaises(ValueError):
                prepare(root, DAY, 5922)

    def test_status_includes_all_talkgroups_on_staging(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for group in TALKGROUPS:
                write(archive_path(root, DAY, group) / 'calls.json',
                      {'date': DAY, 'talkgroup': group, 'calls': [call(group)]})
            for branch in ('staging',):
                self.assertEqual({r['talkgroup'] for r in snapshot(root, branch, 'idle')['rows']}, set(TALKGROUPS))


class AudioRunnerTests(unittest.TestCase):
    def test_publishes_after_300_calls_and_final_remainder_for_every_group(self):
        for group in TALKGROUPS:
            with self.subTest(group=group), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                manifest = root / 'queue.json'
                manifest.write_text('queued')
                summary = root / 'openmhz-download-summary.json'
                batches = []
                def download_batch(command, **kwargs):
                    self.assertEqual(command[command.index('--pause-ms') + 1], '1000')
                    batch_size = int(command[command.index('--batch-size') + 1])
                    processed = min(batch_size, 301 - sum(batches))
                    batches.append(processed)
                    summary.write_text('[]')
                    if sum(batches) == 301:
                        manifest.unlink()
                with patch.object(audio_runner, 'prepare', return_value={'manifest': str(manifest)}), \
                     patch.object(audio_runner.subprocess, 'run', side_effect=download_batch), \
                     patch.object(audio_runner, 'publish') as publish, \
                     patch.dict(audio_runner.os.environ, {'RUNNER_TEMP': tmp, 'GITHUB_STEP_SUMMARY': ''}):
                    audio_runner.run(DAY, group, 'staging')
                self.assertEqual(batches, [300, 1])
                self.assertEqual(publish.call_args_list,
                                 [mock_call(build=False), mock_call(build=True)])

    def test_intermediate_checkpoint_skips_build_but_still_publishes(self):
        with patch.object(audio_runner.subprocess, 'run') as command:
            audio_runner.publish(build=False)
            audio_runner.publish(build=True)
        self.assertEqual(command.call_args_list, [
            mock_call(['bash', 'scripts/push_openmhz_import.sh'], check=True),
            mock_call(['npm', 'run', 'build'], check=True),
            mock_call(['bash', 'scripts/push_openmhz_import.sh'], check=True),
        ])


class TranscriptionTests(unittest.TestCase):
    def test_r2_three_pass_checkpoint_and_cleanup_for_every_group_and_branch(self):
        audio_bytes = b'0000ftypfixture audio'
        digest = hashlib.sha256(audio_bytes).hexdigest()
        cfg = core.read(core.SETTINGS)
        segment = SimpleNamespace(text='On my way.', tokens=[1, 2], start=0, end=1,
                                  avg_logprob=-0.1, no_speech_prob=0.01, compression_ratio=1)
        class Model:
            def __init__(self, *args, **kwargs): pass
            def transcribe(self, *args, **kwargs): return iter([segment]), None
        for branch in ('staging',):
            for group in TALKGROUPS:
                with self.subTest(branch=branch, group=group), tempfile.TemporaryDirectory() as tmp:
                    parent=Path(tmp); root=parent/'repo'; root.mkdir()
                    folder=archive_path(root, DAY, group)
                    c=call(group)
                    c.update(sha256=digest, size_bytes=len(audio_bytes),
                             audio_storage={'provider':'r2','verified':True,'bucket':'bucket',
                                            'key':f'openmhz/{folder.name}/{c["original_filename"]}',
                                            'sha256':digest,'size_bytes':len(audio_bytes)})
                    write(folder/'calls.json', {'date':DAY,'talkgroup':group,'coverage':'unknown','count':1,'calls':[c]})
                    args=SimpleNamespace(date=DAY,talkgroup=group,target_branch=branch,batch_size=10,
                                         audio_dir=str(parent/'radio-audio-test'), model_dir=str(parent/'models'))
                    with patch.object(core,'ROOT',root), patch.object(transcription,'ROOT',root), \
                         patch.dict(sys.modules, {'faster_whisper':SimpleNamespace(WhisperModel=Model)}), \
                         patch.object(transcription.importlib.metadata,'version',return_value=cfg['engine_version']), \
                         patch.object(transcription,'client_and_bucket',return_value=(object(),'bucket')), \
                         patch.object(transcription,'read_verified',return_value=audio_bytes), \
                         patch.object(transcription.subprocess,'check_output',return_value='1'), \
                         patch.object(transcription.subprocess,'run',return_value=SimpleNamespace(returncode=0)), \
                         patch.object(transcription,'commit_checkpoint') as commit:
                        transcription.run(args)
                    saved=core.read(root/f'transcription-work/{group}/{DAY}/batch-001.json')
                    self.assertEqual(saved['talkgroup'],group)
                    self.assertEqual(set(saved['clips'][c['original_filename']]['passes']), {'original','filtered','context'})
                    self.assertEqual(commit.call_args.args[-2:],(group,branch))
                    self.assertFalse(Path(args.audio_dir).exists())
                    self.assertNotIn('transcript',core.read(folder/'calls.json')['calls'][0])


class RecoveryTests(unittest.TestCase):
    def test_recovery_receives_configured_pause(self):
        with patch.object(recovery, 'recover') as recover, patch.object(audio_runner, 'publish'):
            audio_runner.run(DAY, 5922, 'staging', 'recover', 'proof.json', pause_ms=500)
        self.assertEqual(recover.call_args.kwargs['pause_ms'], 500)

    def test_recovery_is_scoped_and_preserves_manual_proof_hash_guard(self):
        content=b'0000ftypfixture audio'
        digest=hashlib.sha256(content).hexdigest()
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            wanted, unapproved=call(5922), call(5922,1)
            failure=root/f'records-pending-review/openmhz-failures/{DAY}-law-2.json'
            write(failure,{'date':DAY,'talkgroup':5922,'timezone':'America/Denver',
                           'system':'dcfems','count':2,'calls':[wanted,unapproved]})
            write(root/f'records-pending-review/openmhz-failures/{DAY}-car-to-car.json',
                  {'date':DAY,'talkgroup':6001,'invalid_unrelated_fixture':True})
            proof=root/'records-pending-review/openmhz-queues/proof.json'
            write(proof,{'verified_date':DAY,'calls':[{**wanted,'sha256':digest}]})
            fetched=[]; imported=[]
            def download(url,destination): fetched.append(url); destination.write_bytes(content)
            def import_audio(root,source,network,**kwargs):
                imported.append(json.loads(source.read_text()))
                return {'failed':0,'downloaded':1}
            with patch.object(recovery,'Downloader',return_value=SimpleNamespace(download=download)), \
                 patch.object(recovery.subprocess,'run',return_value=SimpleNamespace(stdout='1',returncode=0)), \
                 patch.object(recovery,'import_manifest',side_effect=import_audio):
                recovery.recover(root,DAY,5922,proof)
                self.assertEqual(fetched,[wanted['media_url']])
                self.assertEqual([c['id'] for c in imported[0]['calls']],[wanted['id']])
                write(proof,{'verified_date':DAY,'calls':[{**wanted,'sha256':'0'*64}]})
                with self.assertRaisesRegex(ValueError,'manually downloaded proof'):
                    recovery.recover(root,DAY,5922,proof)


if __name__ == '__main__':
    unittest.main()
