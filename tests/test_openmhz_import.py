import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location("importer", Path(__file__).parents[1] / "scripts/import_openmhz_zips.py")
importer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(importer)


class ImportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.archive = self.root / "openmhz-afpd-car-to-car-2026-09-15.zip"
        self.destination = self.root / "day"
        self.audio = b"\x00\x00\x00\x18ftypM4A \x00\x00\x00\x00"
        self.filename = "dcfems-6001-1789453541.m4a"
        self.call = {"id": "first", "epoch": 1789453541, "displayed_seconds": 2,
                     "talkgroup": 6001, "original_filename": self.filename,
                     "sha256": hashlib.sha256(self.audio).hexdigest(), "size_bytes": len(self.audio)}
        self.data = {"date": "2026-09-15", "timezone": "America/Denver", "system": "dcfems",
                     "talkgroup": 6001, "count": 1, "calls": [self.call]}

    def write_zip(self, extra=None):
        with zipfile.ZipFile(self.archive, "w") as z:
            for name in importer.METADATA:
                z.writestr(name, json.dumps(self.data) if name == "calls.json" else "{}")
            z.writestr(self.filename, self.audio)
            for name, content in (extra or {}).items():
                z.writestr(name, content)

    def validate(self):
        return importer.validate_zip(self.archive, self.destination)

    def test_valid_audio_preserved_and_repeat_accepted(self):
        self.write_zip()
        files, count, source_count = self.validate()
        self.assertEqual((count, source_count), (1, 1))
        self.assertEqual(files[self.filename], self.audio)
        self.destination.mkdir()
        for name, content in files.items():
            (self.destination / name).write_bytes(content)
        self.assertEqual(self.validate()[0], files)
        (self.destination / self.filename).write_bytes(b"conflict")
        with self.assertRaisesRegex(ValueError, "refusing overwrite"):
            self.validate()

    def test_paths_rejected(self):
        for name in ("../escape.m4a", "/escape.m4a", "subdir/file.m4a"):
            self.write_zip({name: self.audio})
            with self.assertRaisesRegex(ValueError, "Unsafe"):
                self.validate()

    def test_hash_and_date_rejected(self):
        self.call["sha256"] = "bad"
        self.write_zip()
        with self.assertRaisesRegex(ValueError, "SHA-256"):
            self.validate()
        self.call["sha256"] = hashlib.sha256(self.audio).hexdigest()
        self.data["date"] = "2026-09-16"
        self.write_zip()
        with self.assertRaisesRegex(ValueError, "Invalid manifest"):
            self.validate()

    def test_duplicate_audio_keeps_alternate_call(self):
        self.data["calls"].append({**self.call, "id": "alternate"})
        self.data["count"] = 2
        self.write_zip()
        files, count, source_count = self.validate()
        normalized = json.loads(files["calls.json"])
        self.assertEqual((count, source_count), (1, 2))
        self.assertEqual(normalized["duplicate_source_calls"][0]["id"], "alternate")
        self.assertEqual(normalized["source_call_count"], 2)

    def test_batch_validation_does_not_extract_or_delete_on_error(self):
        pending = self.root / "records-pending-review"
        pending.mkdir()
        self.write_zip()
        self.archive.rename(pending / self.archive.name)
        (pending / "openmhz-afpd-car-to-car-2026-09-16.zip").write_bytes(b"bad zip")
        with self.assertRaises(zipfile.BadZipFile):
            importer.import_archives(self.root, self.root / "summary.json")
        self.assertEqual(len(list(pending.glob("*.zip"))), 2)
        self.assertFalse((self.root / "public").exists())


if __name__ == "__main__":
    unittest.main()
