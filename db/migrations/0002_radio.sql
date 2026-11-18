-- OpenMHz archive metadata. Audio bytes remain in R2, and source URLs expire.
CREATE TABLE radio_talkgroups (
  system TEXT NOT NULL,
  number INTEGER NOT NULL,
  name TEXT NOT NULL,
  PRIMARY KEY (system, number)
);

CREATE TABLE radio_ids (
  id TEXT PRIMARY KEY
);

CREATE TABLE radio_clips (
  id TEXT PRIMARY KEY,
  system TEXT NOT NULL,
  talkgroup_number INTEGER NOT NULL,
  archive_date TEXT NOT NULL,
  clip_number INTEGER NOT NULL,
  timestamp_utc TEXT NOT NULL,
  original_filename TEXT,
  displayed_seconds INTEGER,
  audio_duration_seconds REAL,
  frequency_hz INTEGER,
  emergency INTEGER,
  transcript TEXT,
  original_transcript TEXT,
  transcript_validated INTEGER,
  needs_review INTEGER,
  audio_provider TEXT,
  audio_bucket TEXT,
  audio_key TEXT,
  audio_sha256 TEXT,
  audio_size_bytes INTEGER,
  audio_verified INTEGER,
  audio_downloaded INTEGER,
  source_duration_matches INTEGER,
  archive_path TEXT NOT NULL,
  UNIQUE (system, talkgroup_number, archive_date, clip_number),
  FOREIGN KEY (system, talkgroup_number) REFERENCES radio_talkgroups(system, number)
);

CREATE TABLE radio_clip_sources (
  clip_id TEXT NOT NULL REFERENCES radio_clips(id),
  radio_id TEXT NOT NULL REFERENCES radio_ids(id),
  source_position INTEGER,
  PRIMARY KEY (clip_id, radio_id)
);

CREATE INDEX radio_clips_by_day ON radio_clips(archive_date, talkgroup_number, clip_number);
CREATE INDEX radio_clips_by_radio_day ON radio_clips(system, talkgroup_number, archive_date);
CREATE INDEX radio_sources_by_radio ON radio_clip_sources(radio_id, clip_id);
