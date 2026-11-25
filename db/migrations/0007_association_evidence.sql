-- An isolated review pipeline. Public association builders still read JSON.
-- Officer keys and OpenMHz clip IDs are stable external identities. They are
-- deliberately not coupled to the legacy JSON importer's recreated tables.
CREATE TABLE IF NOT EXISTS radio_associations (
  id TEXT PRIMARY KEY,
  officer_key TEXT NOT NULL,
  officer_name TEXT NOT NULL,
  radio_id TEXT NOT NULL,
  source_status TEXT NOT NULL,
  website_visible INTEGER NOT NULL DEFAULT 0 CHECK (website_visible IN (0, 1)),
  source_json TEXT NOT NULL,
  UNIQUE (officer_key, radio_id)
);
CREATE TABLE IF NOT EXISTS radio_association_evidence (
  id TEXT PRIMARY KEY,
  association_id TEXT NOT NULL REFERENCES radio_associations(id),
  archive_date TEXT NOT NULL,
  talkgroup_number INTEGER NOT NULL,
  website_visible INTEGER NOT NULL DEFAULT 0 CHECK (website_visible IN (0, 1)),
  source_json TEXT NOT NULL,
  reviewed INTEGER NOT NULL DEFAULT 0 CHECK (reviewed IN (0, 1)),
  correction_notes TEXT NOT NULL DEFAULT '',
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  updated_at TEXT,
  updated_by TEXT,
  UNIQUE (association_id, archive_date, talkgroup_number)
);
CREATE INDEX IF NOT EXISTS association_evidence_review ON radio_association_evidence(website_visible, reviewed, association_id);
CREATE TABLE IF NOT EXISTS radio_association_evidence_clips (
  evidence_id TEXT NOT NULL REFERENCES radio_association_evidence(id),
  clip_id TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position > 0),
  speaker_confirmed INTEGER NOT NULL DEFAULT 0 CHECK (speaker_confirmed IN (0, 1)),
  PRIMARY KEY (evidence_id, clip_id)
);
CREATE INDEX IF NOT EXISTS association_evidence_clip ON radio_association_evidence_clips(clip_id);
CREATE TABLE IF NOT EXISTS radio_association_assignments (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  source_json TEXT NOT NULL
);
