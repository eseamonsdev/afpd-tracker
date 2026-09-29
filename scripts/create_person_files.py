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
