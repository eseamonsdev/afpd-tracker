import json
from pathlib import Path

repo_root = Path(__file__).resolve().parent.parent
officers_dir = repo_root / "data/entities/people/officers"
pages_dir = repo_root / "data/entities/pages"

pages_dir.mkdir(parents=True, exist_ok=True)

for officer_file in sorted(officers_dir.glob("*.json")):
    name = officer_file.stem
    page_file = pages_dir / f"{name}-page.json"

    if page_file.exists():
        print(f"Skipped existing: {page_file.name}")
        continue

    page = {
        "entities": [
            {
                "id": f"entity-officer-page-{name}",
                "type": "officer-page",
                "name": {
                    "$ref": f"entity-person-{name}",
                    "$path": ["name"],
                },
                "url": f"/officers/{name}/",
            }
        ]
    }

    page_file.write_text(json.dumps(page, indent=2) + "\n", encoding="utf-8")
    print(f"Created: {page_file.name}")
