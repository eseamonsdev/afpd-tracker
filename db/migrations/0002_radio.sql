-- OpenMHz archive metadata. Audio bytes remain in R2, and source URLs expire.
CREATE TABLE radio_talkgroups (
  system TEXT NOT NULL,
  number INTEGER NOT NULL,
  name TEXT NOT NULL,
  PRIMARY KEY (system, number)
);

CREATE TABLE radio_ids (
  radio_id TEXT PRIMARY KEY
);

CREATE TABLE radio_clips (
  id TEXT PRIMARY KEY,
  system TEXT NOT NULL,
  talkgroup_number INTEGER NOT NULL,
  archive_date TEXT NOT NULL,
  clip_number INTEGER NOT NULL CHECK (clip_number > 0),
  timestamp_utc TEXT NOT NULL,
  original_filename TEXT,
  displayed_seconds INTEGER CHECK (displayed_seconds >= 0),
  audio_duration_seconds REAL CHECK (audio_duration_seconds >= 0),
  frequency_hz INTEGER,
  emergency INTEGER CHECK (emergency IN (0, 1)),
  transcript TEXT,
  original_transcript TEXT,
  transcript_validated INTEGER NOT NULL DEFAULT 0 CHECK (transcript_validated IN (0, 1)),
  needs_review INTEGER CHECK (needs_review IN (0, 1)),
  audio_provider TEXT,
  audio_bucket TEXT,
  audio_key TEXT,
  audio_sha256 TEXT,
  audio_size_bytes INTEGER CHECK (audio_size_bytes >= 0),
  audio_verified INTEGER CHECK (audio_verified IN (0, 1)),
  audio_downloaded INTEGER CHECK (audio_downloaded IN (0, 1)),
  source_duration_matches INTEGER CHECK (source_duration_matches IN (0, 1)),
  archive_path TEXT NOT NULL,
  UNIQUE (system, talkgroup_number, archive_date, clip_number),
  FOREIGN KEY (system, talkgroup_number) REFERENCES radio_talkgroups(system, number)
);

CREATE TABLE radio_clip_radio_ids (
  clip_id TEXT NOT NULL REFERENCES radio_clips(id),
  radio_id TEXT NOT NULL REFERENCES radio_ids(radio_id),
  source_position INTEGER,
  PRIMARY KEY (clip_id, radio_id)
);

CREATE INDEX radio_clips_by_day ON radio_clips(archive_date, talkgroup_number, clip_number);
CREATE INDEX radio_clips_by_radio_day ON radio_clips(system, talkgroup_number, archive_date);
CREATE INDEX radio_clip_radio_ids_by_radio ON radio_clip_radio_ids(radio_id, clip_id);
