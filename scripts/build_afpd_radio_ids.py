#!/usr/bin/env python3
"""Combine available AFPD radio IDs and their source call IDs, without network access."""
import argparse
import json
from collections import defaultdict
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

ROOT = Path(__file__).resolve().parents[1]


def build(archive_dir, inventory):
    manifests = sorted(archive_dir.glob("*/calls.json"))
    sources = []
    calls = {}
    for path in manifests:
        manifest = json.loads(path.read_text())
        included = [c for c in manifest["calls"] if c.get("talkgroup", manifest.get("talkgroup")) == 6001]
        if not included:
            continue
        sources.append({"talkgroup": 6001, "date": manifest["date"], "path": f"public/records/openmhz/{path.parent.name}/calls.json", "call_count": len(included)})
        for call in included:
            query = parse_qs(urlsplit(call.get("call_link", "")).query)
            call_id = call.get("id") or (query.get("call-id") or [None])[0]
            if not call_id:
                raise ValueError(f"Missing call ID in {path}: {call.get('original_filename')}")
            ids = {str(s["src"]) for s in (call.get("srcList") or []) if s.get("src") is not None}
            ids.update(str(r) for r in (call.get("radio_ids") or []))
            calls[(6001, call_id)] = ids
    data = json.loads(inventory.read_text())
    assert data["talkgroup"] == 6036
    sources.append({"talkgroup": 6036, "path": "data/sources/openmhz/6036-inventory.json", "inventoried_at_utc": data["inventoried_at_utc"], "earliest_utc": data["earliest_utc"], "latest_utc": data["latest_utc"], "counts_by_mountain_date": data["counts_by_mountain_date"], "call_count": len(data["calls"])})
    for call in data["calls"]:
        assert call["talkgroupNum"] == 6036
        calls[(6036, call["_id"])] = {str(s["src"]) for s in (call.get("srcList") or []) if s.get("src") is not None}
    all_ids = sorted({rid for ids in calls.values() for rid in ids}, key=int)
    radios = []
    for rid in all_ids:
        grouped = {str(tg): sorted(cid for (group, cid), ids in calls.items() if group == tg and rid in ids) for tg in (6001, 6036)}
        radios.append({"radio_id": rid, "talkgroups": [int(tg) for tg, ids in grouped.items() if ids], "call_count": sum(map(len, grouped.values())), "call_ids_by_talkgroup": grouped})
    by_group = {str(tg): sorted(cid for group, cid in calls if group == tg) for tg in (6001, 6036)}
    missing = {str(tg): sorted(cid for (group, cid), ids in calls.items() if group == tg and not ids) for tg in (6001, 6036)}
    return {
        "schema_version": 1,
        "system": "dcfems",
        "talkgroups": {"6001": "American Fork PD Car to Car", "6036": "American Fork Police"},
        "coverage": "All repository 6001 call manifests, plus the retained 6036 inventory captured at the source timestamp. This is not a complete historical or current live inventory of both talkgroups.",
        "id_semantics": "Radio IDs identify transmitting radios; call IDs identify individual OpenMHz recordings. Compare radio IDs across talkgroups within the same system. Radio IDs do not establish officer identities.",
        "call_count": len(calls),
        "unique_radio_id_count": len(all_ids),
        "radio_ids": all_ids,
        "radio_ids_in_both_talkgroups": [r["radio_id"] for r in radios if len(r["talkgroups"]) == 2],
        "call_ids_by_talkgroup": by_group,
        "calls_without_available_radio_ids_by_talkgroup": missing,
        "radios": radios,
        "sources": sources,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive-dir", type=Path, default=ROOT / "public/records/openmhz")
    parser.add_argument("--inventory", type=Path, default=ROOT / "data/sources/openmhz/6036-inventory.json")
    parser.add_argument("--output", type=Path, default=ROOT / "public/records/openmhz/afpd-radio-ids.json")
    args = parser.parse_args()
    result = build(args.archive_dir, args.inventory)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({"output": str(args.output), "calls": result["call_count"], "unique_radio_ids": result["unique_radio_id_count"], "shared_radio_ids": result["radio_ids_in_both_talkgroups"], "calls_without_radio_ids": {tg: len(ids) for tg, ids in result["calls_without_available_radio_ids_by_talkgroup"].items()}}, indent=2))
