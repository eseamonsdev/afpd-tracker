#!/usr/bin/env python3
"""Validate and import flat OpenMHz day ZIPs without changing audio bytes."""
import argparse
import hashlib
import json
import math
import re
import stat
import subprocess
import tempfile
import zipfile
from datetime import date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ZIP_NAME = re.compile(r"openmhz-afpd-car-to-car-(\d{4}-\d{2}-\d{2})\.zip")
AUDIO_NAME = re.compile(r"dcfems-6001-(\d+)\.m4a")
METADATA = {"calls.json", "rows.json", "download-checkpoint.json", "validation.json", "README.txt", "STATUS.txt"}
MAX_BYTES = 1024 * 1024 * 1024


def validate_zip(archive, destination):
    """Return validated bytes; reject unsafe archives and incomplete manifests."""
    match = ZIP_NAME.fullmatch(archive.name)
    if not match:
        raise ValueError(f"Unexpected ZIP name: {archive.name}")
    day = match[1]
    date.fromisoformat(day)
    with zipfile.ZipFile(archive) as zipped:
        entries = zipped.infolist()
        names = [item.filename for item in entries]
        if len(names) != len(set(names)):
            raise ValueError(f"Duplicate ZIP members: {archive.name}")
        if sum(item.file_size for item in entries) > MAX_BYTES:
            raise ValueError(f"ZIP exceeds 1 GiB: {archive.name}")
        for item in entries:
            if (item.filename not in METADATA and not AUDIO_NAME.fullmatch(item.filename)) or stat.S_ISLNK(item.external_attr >> 16):
                raise ValueError(f"Unsafe or unsupported ZIP member: {item.filename}")
        if not METADATA.issubset(names):
            raise ValueError(f"Missing metadata: {archive.name}")
        files = {name: zipped.read(name) for name in names}
    data = json.loads(files["calls.json"])
    calls = data.get("calls")
    if (data.get("date") != day or data.get("timezone") != "America/Denver"
            or data.get("system") != "dcfems" or data.get("talkgroup") != 6001
            or not isinstance(calls, list) or not calls or data.get("count") != len(calls)):
        raise ValueError(f"Invalid manifest: {archive.name}")
    unique, duplicates, seen_ids = {}, [], set()
    for call in calls:
        filename = call.get("original_filename", "")
        match = AUDIO_NAME.fullmatch(filename)
        epoch = call.get("epoch")
        seconds = call.get("displayed_seconds")
        if (not match or filename not in files or not isinstance(epoch, (int, float))
                or not math.isfinite(epoch) or int(match[1]) != epoch
                or not isinstance(seconds, (int, float)) or not math.isfinite(seconds) or seconds < 0
                or call.get("talkgroup") != 6001 or not call.get("id") or call["id"] in seen_ids):
            raise ValueError(f"Invalid call: {filename}")
        seen_ids.add(call["id"])
        if datetime.fromtimestamp(epoch, ZoneInfo("America/Denver")).date().isoformat() != day:
            raise ValueError(f"Audio outside Mountain date: {filename}")
        audio = files[filename]
        if len(audio) < 12 or audio[4:8] != b"ftyp":
            raise ValueError(f"Not M4A audio: {filename}")
        if "size_bytes" in call and call["size_bytes"] != len(audio):
            raise ValueError(f"Size mismatch: {filename}")
        if "sha256" in call and call["sha256"] != hashlib.sha256(audio).hexdigest():
            raise ValueError(f"SHA-256 mismatch: {filename}")
        if filename in unique:
            # Keep alternate source call IDs in metadata; the site needs unique audio.
            duplicates.append(call)
        else:
            unique[filename] = call
    if {name for name in files if AUDIO_NAME.fullmatch(name)} != set(unique):
        raise ValueError(f"Unreferenced audio: {archive.name}")
    if duplicates:
        data["source_call_count"] = len(calls)
        data["duplicate_source_calls"] = duplicates
        data["calls"] = list(unique.values())
        data["count"] = len(unique)
        files["calls.json"] = (json.dumps(data, indent=2) + "\n").encode()
    # A repeat upload is harmless; differing content must be reviewed manually.
    if destination.exists():
        existing = {p.name for p in destination.iterdir() if p.is_file()}
        if existing != set(files) or any((destination / name).read_bytes() != content for name, content in files.items()):
            raise ValueError(f"Existing day differs; refusing overwrite: {destination}")
    return files, len(unique), len(calls)


def import_archives(root, summary):
    pending = root / "records-pending-review"
    target = root / "public/records/openmhz"
    archives = sorted(p for p in pending.glob("openmhz-afpd-car-to-car-*.zip"))
    # Validate the entire batch before any extraction or source deletion.
    validated = [(p, *validate_zip(p, target / p.stem)) for p in archives]
    results = []
    for archive, files, count, source_count in validated:
        destination = target / archive.stem
        destination.mkdir(parents=True, exist_ok=True)
        for name, content in files.items():
            (destination / name).write_bytes(content)
        results.append({"date": archive.stem[-10:], "audio_files": count, "source_calls": source_count})
    if results:
        subprocess.run(["node", "--input-type=module", "-e", "import { buildRadioIndex } from './lib/build-radio-index.js'; buildRadioIndex();"], cwd=root, check=True)
        for archive, *_ in validated:
            archive.unlink()
    summary.write_text(json.dumps(results, indent=2) + "\n")
    return results


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument("--summary", type=Path, default=Path(tempfile.gettempdir()) / "openmhz-import-summary.json")
    args = parser.parse_args()
    print(json.dumps(import_archives(args.root.resolve(), args.summary)))
