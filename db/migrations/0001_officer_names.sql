-- D1-compatible first phase. The published site continues to read its JSON files.
CREATE TABLE officers (
  id INTEGER PRIMARY KEY,
  legacy_entity_id TEXT NOT NULL UNIQUE,
  url_slug TEXT NOT NULL UNIQUE,
  display_name_id INTEGER,
  FOREIGN KEY (id, display_name_id) REFERENCES officer_names(officer_id, id)
);

CREATE TABLE officer_names (
  id INTEGER PRIMARY KEY,
  officer_id INTEGER NOT NULL REFERENCES officers(id),
  name_text TEXT NOT NULL,
  given_name TEXT,
  middle_names TEXT,
  family_name TEXT,
  kind TEXT NOT NULL DEFAULT 'personal_name'
    CHECK (kind IN ('personal_name', 'search_term', 'radio_alias')),
  source_path TEXT NOT NULL,
  source_fields TEXT NOT NULL,
  UNIQUE (officer_id, name_text),
  UNIQUE (officer_id, id)
);

CREATE INDEX officer_names_by_officer ON officer_names(officer_id);
CREATE INDEX officer_names_by_text ON officer_names(name_text COLLATE NOCASE);
