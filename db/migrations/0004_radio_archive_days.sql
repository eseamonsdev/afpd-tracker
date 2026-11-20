-- A day/talkgroup archive and its effective player settings.
CREATE TABLE radio_archive_days (
  system TEXT NOT NULL,
  talkgroup_number INTEGER NOT NULL,
  archive_date TEXT NOT NULL,
  archive_path TEXT NOT NULL UNIQUE,
  timezone TEXT NOT NULL,
  start_utc TEXT,
  end_utc_exclusive TEXT,
  clip_count INTEGER NOT NULL CHECK (clip_count >= 0),
  source_call_count INTEGER CHECK (source_call_count >= 0),
  coverage TEXT,
  coverage_note TEXT,
  collected_through_utc TEXT,
  download_failure_count INTEGER CHECK (download_failure_count >= 0),
  player_enabled INTEGER NOT NULL CHECK (player_enabled IN (0, 1)),
  transcripts_enabled INTEGER NOT NULL CHECK (transcripts_enabled IN (0, 1)),
  extra_json TEXT CHECK (extra_json IS NULL OR json_valid(extra_json)),
  PRIMARY KEY (system, talkgroup_number, archive_date),
  FOREIGN KEY (system, talkgroup_number) REFERENCES radio_talkgroups(system, number)
);

CREATE INDEX radio_archive_days_by_date ON radio_archive_days(archive_date, talkgroup_number);
