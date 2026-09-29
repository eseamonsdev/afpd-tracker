"""Create or complete person entities from a JSON file in scripts/src.

Run ``python scripts/create_person_files.py`` for scripts/src/officers.json, or
``python scripts/create_person_files.py civilians.json`` for another source.
Each source has a top-level list (for example, ``{"officers": [...]}``) whose
entries include ``base-id``, ``roles``, and ``name`` or ``*-name-label``.
Missing NPI and Transparent Utah resources are added to their respective
source JSON files, with each list sorted by ID.
Officer entries also create or complete a page in data/entities/pages.
"""

import argparse
import json
import re
from datetime import date
from pathlib import Path
from urllib.parse import urlparse


REPO_ROOT = Path(__file__).resolve().parent.parent
SOURCE_DIR = Path(__file__).resolve().parent / "src"
PEOPLE_DIR = REPO_ROOT / "data/entities/people"
PAGES_DIR = REPO_ROOT / "data/entities/pages"
NPI_FILE = REPO_ROOT / "data/sources/external/national-police-index.json"
TRANSPARENT_UTAH_FILE = REPO_ROOT / "data/sources/file/transparent-utah.json"
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


def prepare_npi_resources(people):
    """Match existing profile URLs and prepare missing resources for the file."""
    urls = [row.get("npi-profile-url", "") for row in people]
    if any(not isinstance(url, str) for url in urls):
        raise ValueError("npi-profile-url must be a string")
    if not any(urls):
        return {}, None

    data = json.loads(NPI_FILE.read_text(encoding="utf-8"))
    resources = data.get("resources")
    if not isinstance(resources, list):
        raise ValueError(f"{NPI_FILE}: expected a resources list")

    by_id = {}
    by_url = {}
    for resource in resources:
        if not isinstance(resource, dict) or not isinstance(resource.get("id"), str) or not isinstance(resource.get("url"), str):
            raise ValueError(f"{NPI_FILE}: each resource needs an id and url")
        resource_id, url = resource["id"], resource["url"]
        if resource_id in by_id or url in by_url:
            raise ValueError(f"{NPI_FILE}: duplicate resource id or URL: {resource_id}")
        by_id[resource_id] = resource
        by_url[url] = resource_id

    profile_ids = {}
    for row in people:
        url = row.get("npi-profile-url", "")
        if not url:
            continue
        proposed_id = npi_source_id(url, row.get("npi-source-id"))
        if url in by_url:
            existing_id = by_url[url]
            if row.get("npi-source-id") and proposed_id != existing_id:
                raise ValueError(f"{url}: npi-source-id differs from existing resource {existing_id}")
            profile_ids[url] = existing_id
            continue
        if proposed_id in by_id:
            raise ValueError(f"{url}: resource ID {proposed_id} already belongs to another URL; set npi-source-id")
        resource = {
            "id": proposed_id,
            "type": "external",
            "label": "National Police Index Profile",
            "url": url,
        }
        resources.append(resource)
        by_id[proposed_id] = resource
        by_url[url] = proposed_id
        profile_ids[url] = proposed_id

    data["resources"] = sorted(resources, key=lambda resource: resource["id"])
    return profile_ids, data


def prepare_compensation_files(people):
    """Add missing Transparent Utah CSV definitions without editing existing ones."""
    requested = []
    for row in people:
        base_id = row.get("base-id")
        exists = row.get("transparent-utah-csv-exists", False)
        if not isinstance(exists, bool):
            raise ValueError(f"{base_id}: transparent-utah-csv-exists must be true or false")
        if exists:
            requested.append(base_id)
    if not requested:
        return None

    data = json.loads(TRANSPARENT_UTAH_FILE.read_text(encoding="utf-8"))
    files = data.get("files")
    if not isinstance(files, list):
        raise ValueError(f"{TRANSPARENT_UTAH_FILE}: expected a files list")
    ids = set()
    for resource in files:
        if not isinstance(resource, dict) or not isinstance(resource.get("id"), str):
            raise ValueError(f"{TRANSPARENT_UTAH_FILE}: each file needs an id")
        if resource["id"] in ids:
            raise ValueError(f"{TRANSPARENT_UTAH_FILE}: duplicate ID {resource['id']}")
        ids.add(resource["id"])

    for base_id in requested:
        resource_id = f"transparent-utah-{base_id}-public-compensation"
        if resource_id in ids:
            continue
        files.append({
            "id": resource_id,
            "type": "file",
            "label": "Transparent Utah Public Compensation Records",
            "path": f"transparent-utah/{base_id}-transparent-utah-public-compensation.csv",
        })
        ids.add(resource_id)

    data["files"] = sorted(files, key=lambda resource: resource["id"])
    return data


def employment_records(row, base_id, profile_ids):
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
        records.append({"$ref": profile_ids[npi_url]})
    return records


def person_fields(row, profile_ids):
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
    records = employment_records(row, base_id, profile_ids)
    if records or "officer" in roles:
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


def existing_officer_pages():
    """Find officer page entities even if their filenames have changed."""
    found = {}
    for path in PAGES_DIR.rglob("*.json"):
        data = json.loads(path.read_text(encoding="utf-8"))
        for entity in data.get("entities", []):
            entity_id = entity.get("id")
            if not entity_id or not entity_id.startswith("entity-officer-page-"):
                continue
            if entity_id in found:
                raise ValueError(f"Duplicate entity ID {entity_id}: {found[entity_id]} and {path}")
            found[entity_id] = path
    return found


def format_date(value, base_id, field):
    if not value:
        return None
    if not isinstance(value, str):
        raise ValueError(f"{base_id}: {field} must be an ISO date or empty")
    try:
        parsed = date.fromisoformat(value)
    except ValueError as exc:
        raise ValueError(f"{base_id}: invalid {field}: {value!r}") from exc
    return f"{parsed:%B} {parsed.day}, {parsed.year}"


def officer_page_fields(row, person):
    """Build the defaults for an officer page; existing sections stay intact."""
    if "officer" not in person["roles"]:
        return None
    base_id = row["base-id"]
    label = person["name"]
    if "," in label:
        surname, given = (part.strip() for part in label.split(",", 1))
        full_name = f"{given} {surname}"
    else:
        full_name = label
        surname = label.split()[-1]

    start = format_date(row.get("start-date"), base_id, "start-date")
    end = format_date(row.get("end-date"), base_id, "end-date")
    employment_status = row.get("employment-status")
    if employment_status is None:
        employment_status = "former" if end is not None else "current"
    elif employment_status not in {"current", "former"}:
        raise ValueError(
            f"{base_id}: employment-status must be 'current' or 'former'"
        )
    if start and end:
        employment = f"Officer {surname} worked for the American Fork Police Department from {start} to {end}."
    elif start:
        employment = f"Officer {surname} began working for the American Fork Police Department on {start}."
    elif end:
        employment = f"Officer {surname} worked for the American Fork Police Department until {end}."
    else:
        employment = f"Employment dates for Officer {surname} are not yet available."

    person_id = person["id"]
    return {
        "id": f"entity-officer-page-{base_id}",
        "type": "officer-page",
        "employment-status": employment_status,
        "name": {"$ref": person_id, "$path": ["name"]},
        "url": f"/officers/{base_id}/",
        "sections": [
            {
                "title": "Overview",
                "descriptions": [
                    f"This page brings together available employment and compensation records related to {full_name}."
                ],
            },
            {
                "title": "Employment",
                "descriptions": [employment],
                "contents": [{"$ref": person_id, "$path": ["employment-records"], "$spread": True}],
            },
        ],
    }


def write_entity(path, entity_id, desired, entity_type, managed_fields=()):
    """Fill absent fields and refresh fields explicitly managed by the script."""
    if path.exists():
        data = json.loads(path.read_text(encoding="utf-8"))
        matches = [e for e in data.get("entities", []) if e.get("id") == entity_id]
        if len(matches) != 1:
            raise ValueError(f"{path}: expected exactly one {entity_id} entity")
        entity = matches[0]
        if entity.get("type", entity_type) != entity_type:
            raise ValueError(f"{path}: {entity_id} is not a {entity_type}")
        changes = {key: value for key, value in desired.items() if key not in entity}
        for key in managed_fields:
            if key in desired and entity.get(key) != desired[key]:
                changes[key] = desired[key]
        if not changes:
            print(f"Unchanged: {path.relative_to(REPO_ROOT)}")
            return "unchanged"
        entity.update(changes)
        action = "updated"
    else:
        data = {"entities": [desired]}
        action = "created"

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"{action.title()}: {path.relative_to(REPO_ROOT)}")
    return action


def create_person_files(source_file):
    people = read_people(source_file)
    profile_ids, npi_data = prepare_npi_resources(people)
    compensation_data = prepare_compensation_files(people)
    existing = existing_person_files()
    existing_pages = existing_officer_pages()
    seen = set()
    planned = []
    counts = {"created": 0, "updated": 0, "unchanged": 0}
    page_counts = {"created": 0, "updated": 0, "unchanged": 0}

    for row in people:
        folder, desired = person_fields(row, profile_ids)
        entity_id = desired["id"]
        if entity_id in seen:
            raise ValueError(f"Duplicate base-id in {source_file}: {row['base-id']}")
        seen.add(entity_id)
        page = officer_page_fields(row, desired)
        planned.append((row, folder, desired, page))

    if npi_data is not None:
        content = json.dumps(npi_data, indent=2, ensure_ascii=False) + "\n"
        if NPI_FILE.read_text(encoding="utf-8") != content:
            NPI_FILE.write_text(content, encoding="utf-8")
            print(f"Updated: {NPI_FILE.relative_to(REPO_ROOT)}")

    if compensation_data is not None:
        content = json.dumps(compensation_data, indent=2, ensure_ascii=False) + "\n"
        if TRANSPARENT_UTAH_FILE.read_text(encoding="utf-8") != content:
            TRANSPARENT_UTAH_FILE.write_text(content, encoding="utf-8")
            print(f"Updated: {TRANSPARENT_UTAH_FILE.relative_to(REPO_ROOT)}")

    for row, folder, desired, page in planned:
        entity_id = desired["id"]
        path = existing.get(entity_id, PEOPLE_DIR / folder / f"{row['base-id']}.json")
        action = write_entity(path, entity_id, desired, "person")
        counts[action] += 1
        if action == "created":
            existing[entity_id] = path
        if page is not None:
            page_id = page["id"]
            page_path = existing_pages.get(page_id, PAGES_DIR / f"{row['base-id']}-page.json")
            page_action = write_entity(
                page_path,
                page_id,
                page,
                "officer-page",
                managed_fields=("employment-status",),
            )
            page_counts[page_action] += 1
            if page_action == "created":
                existing_pages[page_id] = page_path

    print(f"People: {counts['created']} created, {counts['updated']} updated, {counts['unchanged']} unchanged")
    print(f"Officer pages: {page_counts['created']} created, {page_counts['updated']} updated, {page_counts['unchanged']} unchanged")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", nargs="?", default="officers.json", help="JSON filename in scripts/src")
    args = parser.parse_args()
    source_file = SOURCE_DIR / args.source
    create_person_files(source_file)


if __name__ == "__main__":
    main()
