import hashlib
import io
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parents[1] / 'scripts'))
from r2_audio import upload_one, upload_new, stored_audio, hydrate


class Missing(Exception):
    response = {'Error': {'Code': 'NoSuchKey'}}


class Bucket:
    def __init__(self):
        self.objects = {}
        self.puts = 0
        self.corrupt = False

    def get_object(self, Bucket, Key):
        if Key not in self.objects:
            raise Missing()
        return {'Body': io.BytesIO(b'corrupt' if self.corrupt else self.objects[Key])}

    def put_object(self, Bucket, Key, Body, **kwargs):
        assert kwargs['IfNoneMatch'] == '*'
        assert Key not in self.objects
        self.objects[Key] = Body
        self.puts += 1


class R2Test(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.folder = self.root / 'public/records/openmhz/openmhz-afpd-car-to-car-2026-10-25'
        self.folder.mkdir(parents=True)
        self.path = self.folder / 'dcfems-6001-1792908038.m4a'
        self.path.write_bytes(b'original audio bytes')
        self.call = {'original_filename': self.path.name, 'size_bytes': self.path.stat().st_size,
                     'sha256': hashlib.sha256(self.path.read_bytes()).hexdigest()}
        self.client = Bucket()

    def test_upload_readback_idempotence_and_hydration(self):
        storage = upload_one(self.client, 'bucket', self.path, self.call, self.folder.name)
        self.call['audio_storage'] = storage
        self.assertTrue(stored_audio(self.call, self.folder.name))
        upload_one(self.client, 'bucket', self.path, self.call, self.folder.name)
        self.assertEqual(self.client.puts, 1)
        (self.folder / 'calls.json').write_text(json.dumps({'calls': [self.call]}))
        self.path.unlink()
        self.assertEqual(hydrate(self.folder, self.client, 'bucket'), 1)
        self.assertEqual(self.path.read_bytes(), b'original audio bytes')

    def test_conflicting_object_is_not_overwritten(self):
        key = 'openmhz/' + self.folder.name + '/' + self.path.name
        self.client.objects[key] = b'different audio'
        with self.assertRaisesRegex(ValueError, 'checksum'):
            upload_one(self.client, 'bucket', self.path, self.call, self.folder.name)
        self.assertEqual(self.client.puts, 0)

    def test_metadata_only_hydration_is_opt_in_and_keeps_saved_audio_checks(self):
        storage = upload_one(self.client, 'bucket', self.path, self.call, self.folder.name)
        self.call['audio_storage'] = storage
        pending = {'original_filename': 'dcfems-6001-1792908040.m4a'}
        metadata = self.folder / 'calls.json'
        metadata.write_text(json.dumps({'calls': [self.call, pending]}))
        self.path.unlink()
        self.assertEqual(hydrate(self.folder, self.client, 'bucket', allow_metadata_only=True), 1)
        self.assertFalse((self.folder / pending['original_filename']).exists())
        with self.assertRaisesRegex(ValueError, 'Missing audio'):
            hydrate(self.folder, self.client, 'bucket')
        pending['sha256'] = '0' * 64
        metadata.write_text(json.dumps({'calls': [self.call, pending]}))
        with self.assertRaisesRegex(ValueError, 'Missing audio'):
            hydrate(self.folder, self.client, 'bucket', allow_metadata_only=True)

    def test_failed_readback_does_not_publish_manifest(self):
        subprocess.run(['git', 'init', '-q', str(self.root)], check=True)
        (self.root / '.gitignore').write_text('*.m4a\n')
        metadata = self.folder / 'calls.json'
        original = json.dumps({'calls': [self.call]})
        metadata.write_text(original)
        self.client.corrupt = True
        with self.assertRaisesRegex(ValueError, 'checksum'):
            upload_new(self.root, self.client, 'bucket')
        self.assertEqual(metadata.read_text(), original)
        self.assertTrue(self.path.exists())

    def test_only_new_audio_uploaded_and_metadata_remains_in_git(self):
        subprocess.run(['git', 'init', '-q', str(self.root)], check=True)
        (self.root / '.gitignore').write_text('*.m4a\n')
        metadata = self.folder / 'calls.json'
        metadata.write_text(json.dumps({'calls': [self.call]}))
        self.assertEqual(upload_new(self.root, self.client, 'bucket'), 1)
        data = json.loads(metadata.read_text())
        self.assertTrue(stored_audio(data['calls'][0], self.folder.name))
        subprocess.run(['git', '-C', str(self.root), 'add', '.'], check=True)
        tracked = subprocess.check_output(['git', '-C', str(self.root), 'ls-files'], text=True)
        self.assertIn('calls.json', tracked)
        self.assertNotIn('.m4a', tracked)

    def test_publication_does_not_read_verified_existing_objects_again(self):
        subprocess.run(['git', 'init', '-q', str(self.root)], check=True)
        (self.root / '.gitignore').write_text('*.m4a\n')
        self.call['audio_storage'] = upload_one(self.client, 'bucket', self.path, self.call, self.folder.name)
        new_path = self.folder / 'dcfems-6001-1792908040.m4a'
        new_path.write_bytes(b'new audio')
        new_call = {'original_filename': new_path.name, 'size_bytes': 9,
                    'sha256': hashlib.sha256(b'new audio').hexdigest()}
        (self.folder / 'calls.json').write_text(json.dumps({'calls': [self.call, new_call]}))
        with patch.object(self.client, 'get_object', wraps=self.client.get_object) as get:
            self.assertEqual(upload_new(self.root, self.client, 'bucket'), 1)
        self.assertTrue(get.call_args_list)
        self.assertTrue(all(c.kwargs['Key'].endswith(new_path.name) for c in get.call_args_list))
        self.assertEqual(self.client.puts, 2)


if __name__ == '__main__':
    unittest.main()
