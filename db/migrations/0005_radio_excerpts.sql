-- Curated radio excerpts and their clips in playback order.
CREATE TABLE radio_excerpts (
  id TEXT PRIMARY KEY,
  number INTEGER NOT NULL UNIQUE CHECK (number > 0),
  slug TEXT NOT NULL UNIQUE,
  subtitle TEXT NOT NULL,
  description TEXT,
  transcripts_enabled INTEGER NOT NULL CHECK (transcripts_enabled IN (0, 1)),
  source_file_path TEXT NOT NULL,
  extra_json TEXT CHECK (extra_json IS NULL OR json_valid(extra_json))
);

-- Section and range metadata repeat on each member to preserve the JSON's
-- grouping without creating a third table.
CREATE TABLE radio_excerpt_clips (
  excerpt_id TEXT NOT NULL REFERENCES radio_excerpts(id),
  position INTEGER NOT NULL CHECK (position > 0),
  clip_id TEXT NOT NULL REFERENCES radio_clips(id),
  section_number INTEGER NOT NULL CHECK (section_number > 0),
  section_title TEXT,
  section_description TEXT,
  range_number INTEGER NOT NULL CHECK (range_number > 0),
  PRIMARY KEY (excerpt_id, position),
  UNIQUE (excerpt_id, clip_id)
);

CREATE INDEX radio_excerpt_clips_by_clip ON radio_excerpt_clips(clip_id, excerpt_id);
