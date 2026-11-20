-- One row per item in data/sources/**/*.json, preserving its existing ID.
CREATE TABLE sources (
  source_id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL
    CHECK (source_type IN ('file', 'external', 'youtube', 'news', 'audio')),
  label TEXT NOT NULL,
  url TEXT,
  file_path TEXT,
  publisher TEXT,
  channel TEXT,
  published_date TEXT,
  description TEXT,
  duration_seconds INTEGER CHECK (duration_seconds >= 0),
  extra_json TEXT CHECK (extra_json IS NULL OR json_valid(extra_json)),
  source_file_path TEXT NOT NULL,
  CHECK ((url IS NULL) <> (file_path IS NULL)),
  CHECK ((source_type = 'file') = (file_path IS NOT NULL))
);

CREATE INDEX sources_by_type ON sources(source_type);
CREATE INDEX sources_by_published_date ON sources(published_date);
