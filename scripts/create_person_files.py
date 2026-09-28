"""Create or complete person entities from a JSON file in scripts/src.

Run ``python scripts/create_person_files.py`` for scripts/src/officers.json, or
``python scripts/create_person_files.py civilians.json`` for another source.
Each source has a top-level list (for example, ``{"officers": [...]}``) whose
entries include ``base-id``, ``roles``, and ``name`` or ``*-name-label``.
"""

import argparse
import json
import re
from pathlib import Path
from urllib.parse import urlparse


REPO_ROOT = Path(__file__).resolve().parent.parent
SOURCE_DIR = Path(__file__).resolve().parent / "src"
PEOPLE_DIR = REPO_ROOT / "data/entities/people"
ROLE_FOLDERS = {
    "officer": "officers",
    "civilian": "civilians",
    "civilian-employee": "civilian-employees",
    "city-official": "city-officials",
}


def read_people(source_file):
    data = json.loads(source_file.read_text(encoding="utf-8"))
    if not isinstance(data, dict) or len(data) != 1:
        raise ValueError(f"{source_file}: expected one top-level list, such as 'officers'")
    people = next(iter(data.values()))
    if not isinstance(people, list):
        raise ValueError(f"{source_file}: top-level value must be a list")
    return people


def npi_source_id(url, explicit_id=None):
    """Derive the source ID from the NPI URL, unless one is supplied."""
    parsed = urlparse(url)
    if parsed.scheme != "https" or parsed.netloc != "national.cpdp.co":
        raise ValueError(f"Invalid NPI profile URL: {url!r}")
    parts = parsed.path.strip("/").split("/")
    if len(parts) != 4 or parts[:2] != ["officers", "utah"] or not parts[2].startswith("utah_"):
        raise ValueError(f"Unexpected NPI profile URL: {url!r}")
    if explicit_id is not None:
        if not isinstance(explicit_id, str) or not re.fullmatch(r"national-police-index-[a-z0-9-]+", explicit_id):
            raise ValueError(f"Invalid npi-source-id: {explicit_id!r}")
        return explicit_id
    surname, sep, given = parts[3].rpartition("-")
    if not sep or not surname or not given:
        raise ValueError(f"Provide npi-source-id for this URL: {url!r}")
    return f"national-police-index-{given}-{surname}"


def employment_records(row, base_id):
    records = []
    csv_exists = row.get("transparent-utah-csv-exists", False)
    if not isinstance(csv_exists, bool):
        raise ValueError(f"{base_id}: transparent-utah-csv-exists must be true or false")
    if csv_exists:
        records.append({
            "$ref": f"transparent-utah-{base_id}-public-compensation",
            "$override": {"display": "table"},
        })

    npi_url = row.get("npi-profile-url", "")
    if npi_url:
        if not isinstance(npi_url, str):
            raise ValueError(f"{base_id}: npi-profile-url must be a string")
        records.append({"$ref": npi_source_id(npi_url, row.get("npi-source-id"))})
    return records


def person_fields(row):
    base_id = row.get("base-id")
    if not isinstance(base_id, str) or not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", base_id):
        raise ValueError(f"Invalid base-id: {base_id!r}")

    roles = row.get("roles")
    if not isinstance(roles, list) or not roles or any(not isinstance(r, str) or not r for r in roles):
        raise ValueError(f"{base_id}: roles must be a nonempty list of strings")

    name_labels = [value for key, value in row.items() if key.endswith("-name-label")]
    name = row.get("name") or row.get("person-name-label")
    if not name and len(name_labels) == 1:
        name = name_labels[0]
    if not isinstance(name, str) or not name.strip():
        raise ValueError(f"{base_id}: provide a name or one *-name-label field")

    folder = next((ROLE_FOLDERS[r] for r in roles if r in ROLE_FOLDERS), None)
    if folder is None:
        raise ValueError(f"{base_id}: add a folder mapping for one of these roles: {roles}")

    desired = {
        "id": f"entity-person-{base_id}",
        "type": "person",
        "name": name,
        "roles": roles,
    }
    records = employment_records(row, base_id)
    if records:
        desired["employment-records"] = records
    return folder, desired


def existing_person_files():
    """Locate entities by ID so a role change cannot create a duplicate."""
    found = {}
    for path in PEOPLE_DIR.rglob("*.json"):
        data = json.loads(path.read_text(encoding="utf-8"))
        for entity in data.get("entities", []):
            entity_id = entity.get("id")
            if entity_id in found:
                raise ValueError(f"Duplicate entity ID {entity_id}: {found[entity_id]} and {path}")
            if entity_id:
                found[entity_id] = path
    return found


def create_person_files(source_file):
    people = read_people(source_file)
    existing = existing_person_files()
    seen = set()
    created = updated = unchanged = 0

    for row in people:
        folder, desired = person_fields(row)
        entity_id = desired["id"]
        if entity_id in seen:
            raise ValueError(f"Duplicate base-id in {source_file}: {row['base-id']}")
        seen.add(entity_id)

        path = existing.get(entity_id, PEOPLE_DIR / folder / f"{row['base-id']}.json")
        if path.exists():
            data = json.loads(path.read_text(encoding="utf-8"))
            matches = [e for e in data.get("entities", []) if e.get("id") == entity_id]
            if len(matches) != 1:
                raise ValueError(f"{path}: expected exactly one {entity_id} entity")
            entity = matches[0]
            if entity.get("type", "person") != "person":
                raise ValueError(f"{path}: {entity_id} is not a person")
            missing = {key: value for key, value in desired.items() if key not in entity}
            if not missing:
                unchanged += 1
                print(f"Unchanged: {path.relative_to(REPO_ROOT)}")
                continue
            entity.update(missing)
            updated += 1
            action = "Updated"
        else:
            data = {"entities": [desired]}
            existing[entity_id] = path
            created += 1
            action = "Created"

        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"{action}: {path.relative_to(REPO_ROOT)}")

    print(f"Done: {created} created, {updated} updated, {unchanged} unchanged")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", nargs="?", default="officers.json", help="JSON filename in scripts/src")
    args = parser.parse_args()
    source_file = SOURCE_DIR / args.source
    create_person_files(source_file)


if __name__ == "__main__":
    main()
