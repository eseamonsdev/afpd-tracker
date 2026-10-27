import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).parents[1]


def git(directory, *args):
    return subprocess.check_output(['git', '-C', str(directory), *args], stderr=subprocess.STDOUT, text=True)


class PushTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        seed = self.root / 'seed'
        seed.mkdir()
        git(seed, 'init', '-b', 'staging')
        git(seed, 'config', 'user.name', 'Test')
        git(seed, 'config', 'user.email', 'test@example.com')
        (seed / 'public').mkdir()
        (seed / 'public/transcript.txt').write_text('original\n')
        (seed / 'lib').mkdir()
        shutil.copyfile(REPO / 'lib/build-radio-index.js', seed / 'lib/build-radio-index.js')
        (seed / 'package.json').write_text('{"type":"module"}')
        git(seed, 'add', '.')
        git(seed, 'commit', '-m', 'Initial fixture')
        self.remote = self.root / 'remote.git'
        subprocess.run(['git', 'clone', '--bare', str(seed), str(self.remote)], check=True, capture_output=True)
        self.worker = self.root / 'worker'
        self.editor = self.root / 'editor'
        for directory in (self.worker, self.editor):
            subprocess.run(['git', 'clone', str(self.remote), str(directory)], check=True, capture_output=True)
            git(directory, 'config', 'user.name', 'Test')
            git(directory, 'config', 'user.email', 'test@example.com')

    def test_checkpoint_commits_failures_and_remaining_queue(self):
        failures = self.worker / 'records-pending-review/openmhz-failures'
        pending = self.worker / 'records-pending-review/openmhz-manifests'
        failures.mkdir(parents=True)
        pending.mkdir(parents=True)
        (failures / 'day.json').write_text('{"count":1}')
        (pending / 'day.json').write_text('{"count":3}')
        (self.worker / 'public/audio.m4a').write_bytes(b'validated audio')
        result = self.push()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(git(self.remote, 'show', 'staging:records-pending-review/openmhz-failures/day.json'))['count'], 1)
        self.assertEqual(json.loads(git(self.remote, 'show', 'staging:records-pending-review/openmhz-manifests/day.json'))['count'], 3)

    def edit_remote(self):
        (self.editor / 'public/transcript.txt').write_text('concurrent transcript correction\n')
        git(self.editor, 'add', '.')
        git(self.editor, 'commit', '-m', 'Concurrent edit')
        git(self.editor, 'push', 'origin', 'staging')

    def push(self):
        # These fixtures exercise Git conflict recovery without live cloud access.
        env = dict(os.environ, RUNNER_TEMP=str(self.root), OPENMHZ_AUDIO_STORAGE='',
                   OPENMHZ_TARGET_BRANCH='staging')
        return subprocess.run(['bash', str(REPO / 'scripts/push_openmhz_import.sh')],
                              cwd=self.worker, env=env, capture_output=True, text=True)

    def test_concurrent_transcript_edit_is_preserved_without_redownloading(self):
        self.edit_remote()
        (self.worker / 'public/audio.m4a').write_bytes(b'original downloaded audio')
        result = self.push()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(git(self.remote, 'show', 'staging:public/transcript.txt'), 'concurrent transcript correction\n')
        self.assertEqual(git(self.remote, 'show', 'staging:public/audio.m4a'), 'original downloaded audio')
        self.assertTrue((self.root / 'openmhz-import.bundle').exists())

    def test_real_conflict_retains_audio_bundle_and_does_not_overwrite_remote(self):
        self.edit_remote()
        (self.worker / 'public/transcript.txt').write_text('conflicting worker edit\n')
        (self.worker / 'public/audio.m4a').write_bytes(b'original downloaded audio')
        result = self.push()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(git(self.remote, 'show', 'staging:public/transcript.txt'), 'concurrent transcript correction\n')
        self.assertTrue((self.root / 'openmhz-import.bundle').exists())
        self.assertIn('conflicting changes', result.stderr)

    def add_day(self, directory, day, epoch):
        folder = directory / 'public/records/openmhz' / f'openmhz-afpd-car-to-car-{day}'
        folder.mkdir(parents=True)
        name = f'dcfems-6001-{epoch}.m4a'
        (folder / name).write_bytes(b'original audio')
        (folder / 'calls.json').write_text(json.dumps({'date': day, 'calls': [
            {'epoch': epoch, 'displayed_seconds': 3, 'original_filename': name}]}))
        subprocess.run(['node', '--input-type=module', '-e',
                        "import {buildRadioIndex} from './lib/build-radio-index.js'; buildRadioIndex();"],
                       cwd=directory, check=True, capture_output=True)

    def test_conflicting_derived_indexes_are_rebuilt_with_both_days(self):
        # Establish the same base index in both checkouts.
        base = self.worker / 'public/records/openmhz'
        base.mkdir(parents=True)
        (base / 'index.json').write_text('{"timezone":"America/Denver","days":[]}\n')
        git(self.worker, 'add', '.')
        git(self.worker, 'commit', '-m', 'Base index')
        git(self.worker, 'push', 'origin', 'staging')
        git(self.editor, 'pull', '--ff-only')
        self.add_day(self.worker, '2026-10-11', 1791698556)
        self.add_day(self.editor, '2026-10-12', 1791788302)
        git(self.editor, 'add', '.')
        git(self.editor, 'commit', '-m', 'Concurrent archive day')
        git(self.editor, 'push', 'origin', 'staging')
        result = self.push()
        self.assertEqual(result.returncode, 0, result.stderr)
        index = json.loads(git(self.remote, 'show', 'staging:public/records/openmhz/index.json'))
        self.assertEqual({day['date'] for day in index['days']}, {'2026-10-11', '2026-10-12'})


if __name__ == '__main__':
    unittest.main()

