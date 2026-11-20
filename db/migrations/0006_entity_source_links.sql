-- Source references embedded in entity JSON. Entity records are not yet a
-- general database table, so entity_id is the stable ID from the JSON.
CREATE TABLE entity_source_links (
  entity_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_file_path TEXT NOT NULL,
  source_id TEXT NOT NULL REFERENCES sources(source_id),
  reference_path TEXT NOT NULL,
  field_name TEXT NOT NULL,
  reference_json TEXT NOT NULL CHECK (json_valid(reference_json)),
  PRIMARY KEY (entity_id, reference_path)
);

CREATE INDEX entity_source_links_by_source ON entity_source_links(source_id, entity_id);
CREATE INDEX entity_source_links_by_field ON entity_source_links(entity_type, field_name);
