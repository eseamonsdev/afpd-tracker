# Officer and radio database builder

The public 11ty build still reads the existing JSON. The schema and repeatable
importer are tracked; the generated SQLite file is ignored.

```sh
python3 db/create_afpd_db.py
python3 db/create_afpd_db.py --replace
```

After changing the source JSON, rerun the import with `--replace` to rebuild
the local SQLite file. The live site still reads its existing JSON.

To install the repository's Wrangler version and authenticate separately:

```sh
npm ci
make wrangler-login
```

All database Make commands have fixed targets and take no database parameter.
`db-sync`, `db-upload`, `db-reset`, `calls-from-db`, `evidence-from-db` and
`evidence-to-db` always use **afpd-data-staging**.
The old `D1_DATABASE` argument has been removed: passing it on the command line
or in the environment fails before any database operation. `promote-db` is the
only Make command that writes to production.

### Routine admin sync

```sh
make db-sync
```

Save browser edits first and run from a clean `staging` checkout. The staging
admin database is authoritative for saved transcripts, verification flags and
all association evidence. Ordinary database/JSON differences are expected and
do not require reconciliation, including on the first run. No baseline is
required. The old baseline file is no longer used to decide which values win.

The command pulls staging with fast-forward-only Git operations, exports D1,
validates all archive clip IDs, and imports first-time JSON transcripts only
where the database transcript is null, empty or whitespace. Each conditional
update matches the original database transcript and verification flag; a new
nonblank admin save cannot be overwritten by that import. It then downloads
a fresh, consistent D1 snapshot to confirm the result. Existing nonblank
admin transcripts always win over differing JSON text. First-time imports
carry the JSON verification flag with the text; otherwise database flags win.
Empty database fields cannot be used to erase completed JSON transcripts.

It writes the saved transcripts to `calls.json`, exports every evidence group
to `data/db-evidenence-associations.json`, commits only those changed files,
and pushes staging. An unchanged snapshot produces no empty commit. Existing
local staging commits are also pushed. Evidence notes, confirmations and
deletion history stay in Git for recovery. The last successful commit is
recorded under ignored `db/local/` for information, and old conflict reports
are removed after a successful sync.

The command still stops for actual Git problems, unfinished local changes,
invalid data or missing archive clip IDs. It does not auto-stash, rebase,
force-push, reset the database, import the evidence JSON or deploy the site.
If a remote commit arrives during a download, a rejected push retains the
local sync commit. Browser edits must be saved first: the command cannot see
text still unsaved in an open tab. This is not a general JSON-to-database
upload; its only automatic database writes fill blank transcript fields.

`make calls-from-db` also protects completed JSON text against empty database
values, but only downloads data. Use `make db-sync` to import that protected
first-time text into the database and push the resulting snapshots.

To rebuild a local SQLite snapshot from tracked JSON, back up staging, and apply
the per-table policy to the staging database:

```sh
make db-upload
```

To back up staging and recreate its JSON-managed tables, replacing edits saved
only in those tables, use `make db-reset`. This retains database/binding IDs and
the separate association review tables. An empty staging database can also be
initialized with either upload command.

Before either upload, run `make calls-from-db` to save staging transcript and
verification edits into JSON. It does not export association review data.

### Promote the database

```sh
make promote-db
```

This replaces **afpd-data** with a snapshot of **afpd-data-staging**, including
all association evidence groups, speaker confirmations, reviewed flags,
correction notes, clip selections, and transcripts. The direction is fixed;
there are no source/target or database overrides. It does **not** back up
production, modify staging, export to site JSON, or deploy the website.

The command exports staging to timestamped files under ignored `db/local/`,
checks its integrity, and rehearses the complete replacement locally. The
rehearsal compares all table data, including review notes and transcripts,
before production is changed. It then replaces production and verifies table
names, row counts and foreign keys. Staging snapshot/import files are retained
for retry or recovery if the import fails. A large D1 import can span multiple
transactions; production can be temporarily unavailable or incomplete during
promotion, so avoid using its admin editor during the copy. Staging edits made
after the snapshot are included in the next promotion.

This copies the current staging state into production as a separate copy. It
does not create a versioned archive of previous production states.

`db/table-import-policy.json` specifies `recreate` or `insert_only` for **every**
table. The checked-in policy currently uses `recreate` for every JSON-managed
table, which drops and rebuilds those rows from JSON. Export staging transcript
and verification edits with `make calls-from-db` before an upload. The separate
association review tables are outside this policy. If a table is configured as
`insert_only`, existing-row changes in JSON do not update
an `insert_only` table, including day display settings. The importer rejects a
policy that recreates a parent while leaving dependent child rows in place; `officers` and
`officer_names` must always share a mode because they refer to each other.
For tables with generated numeric IDs, switching to `insert_only` also requires
preserving those IDs when source records are added. Inspect the prepared SQL
and identity mapping before making that switch.

The SQL import and a timestamped pre-upload D1 export are saved under ignored
`db/local/`. The command verifies exact row counts for `recreate` tables and
minimum counts for `insert_only` tables, which may contain additional D1-only
rows. It does not modify the repository or deploy the website. The local SQLite
snapshot is always recreated from JSON and is not a copy of D1. The existing
database and its name are retained; a D1 binding is not added to
`wrangler.jsonc`.
To prepare the SQLite database and SQL import without contacting Cloudflare,
run `python3 db/upload_d1.py --prepare-only`.

`officers.id` is a stable numeric identity within this import, `url_slug` keeps
the existing profile address, and `display_name_id` selects one of that
officer's `officer_names` rows. Every explicitly listed canonical, alternate,
and search name is imported once per officer. There is no automatic generation
of middle-initial or shortened forms. The optional name parts are filled only
when the text has a simple, unambiguous form; `name_text` is always the exact
form to display or search. Generic search phrases such as "Officer Nye" are
excluded; the surname is searchable through the personal name forms.
`kind = radio_alias` stores specifically
confirmed standalone aliases. Unresolved radio cues are not assigned to an
officer. Attested shortened given names such as Tavo are personal names,
with the given-name part populated even when used alone.

`source_path` and `source_fields` indicate *which existing repository field*
was imported; they are not citations to the underlying original record.
The initial IDs are reproducible because source filenames and insertion order
are sorted. Once a remote database exists, its numeric IDs must be preserved
by incremental migrations rather than rebuilding from scratch.

The same import also loads all tracked `public/records/openmhz/*/calls.json`
archives into `radio_talkgroups`, `radio_ids`, `radio_archive_days`,
`radio_clips`, and `radio_clip_radio_ids`. Each `radio_archive_days` row
holds a talkgroup/date archive, its coverage and collection metadata, and its
effective display settings. `player_enabled` indicates whether the day appears
in the site's radio player index; it does not indicate whether audio exists in
R2. `transcripts_enabled` records the day's transcript display setting (from
the Law 2 index or the other daily manifests). Rare archive metadata stays in
`extra_json`. A day can exist in the database even if the player does not list
it. `radio_clips.id` is the OpenMHz call ID and
`(system, talkgroup_number, archive_date, clip_number)` identifies a clip in
the day archive. The audio reference is the R2 key and its recorded checks;
the audio bytes remain in R2. Expiring OpenMHz media and call URLs are not
imported. A clip may have zero or several identified radio sources, and a
radio ID does not imply a permanent officer assignment. The current and
original transcript, review flags, timestamps, and audio metadata are
stored in the database. Officer association decisions and callsign assignments
remain in their existing JSON for now.

## Association evidence review

The isolated admin evidence workspace uses migration
`migrations/0007_association_evidence.sql` and four additional tables:
`radio_associations`, `radio_association_evidence`,
`radio_association_evidence_clips`, and `radio_association_assignments`.
The existing public association builders continue reading JSON.

`prepare_association_evidence.mjs` prepares an additive SQL import under
`db/local/`. It preserves the original evidence, exclusions, production
baseline, shared-use records and clip exceptions. Existing review edits are
never overwritten. It does not contact D1, change public JSON, or deploy.
`make evidence-from-db` saves every staging evidence group, including reviewed,
unreviewed, hidden and empty groups, to `data/db-evidenence-associations.json`.
It performs a consistent D1 export, validates the result and atomically replaces
the JSON. With no changing export timestamp, identical data produces identical
JSON. This file is independent of the public association builders.

The versioned JSON is keyed by radio ID under `radio_ids`, with an
`associations` list for the officers using each radio. Each association contains
its stable ID, officer key/name, status, visibility, original source metadata
and dated talkgroup evidence groups. Groups preserve stable IDs, review flags,
correction notes, revisions, edit attribution, original source records and clip
memberships. Each clip carries its stable OpenMHz ID, playback position and
speaker-confirmed flag. Empty groups remain explicit empty clip lists. The
top-level `assignments` retains exclusions, disputed data and original rules.
`officer_id` is the stable officer slug, not the numeric roster row ID. Date
ranges can be added in a later schema version without conflating this review
file with the public association format.

`make evidence-to-db` explicitly reuploads this file to **staging only**. It
first validates the entire file, exports staging evidence and retains the pre-upload
snapshot and generated SQL under ignored `db/local/evidence-upload-*/`. It
rehearses the import on that snapshot before uploading. Represented groups
receive exactly the file's clip membership (including saved removals), notes
and confirmation flags. Groups and assignment records absent from the file
remain in staging. Existing group revisions advance to invalidate old browser
edit sessions. A natural-key collision with a different stable ID fails the
rehearsal rather than guessing which group to overwrite.

Neither command accepts a database parameter. Ordinary `db-upload` and
`db-reset` continue to retain evidence tables and do not read this file.
Transcripts, transcript verification and audio are not embedded in the evidence
snapshot: use `make calls-from-db` for transcript edits. Neither evidence
command changes public associations or promotes production. `make promote-db`
copies these tables along with the rest of staging into production.

Groups have an independent `reviewed` flag, correction notes and optimistic
revision. Speaker confirmation belongs to a group's clip membership and is
separate from `radio_clips.transcript_validated`. Removal deletes only that
membership. The OpenMHz clip ID and officer key are stable external identities,
so legacy JSON table recreation cannot cascade-delete these reviews. The API
validates every selected recording against its group date and talkgroup;
missing archive references are reported rather than silently discarded.

The full-day admin radio player can append clips to association evidence.
The officer, radio ID, date and talkgroup identify the group; adding clips to
an existing group preserves its notes and speaker confirmations. A selection
containing only existing clips makes no changes. New clips start unconfirmed
and reset the group to Unreviewed. Each included clip links to its evidence
groups, and each evidence group links to its full admin day. This integration
uses the existing evidence tables and does not change public associations.

The evidence editor also offers **Delete evidence group**, with a confirmation
that names the officer, radio, date and talkgroup. It removes only that group's
clip membership and removes the officer/radio row only when no groups remain.
Recordings, transcripts and other groups are retained. A revision check prevents
deleting a group that has changed in another tab. Its saved notes, source records,
membership and deletion attribution are archived in `radio_association_assignments`
as `deleted-evidence-group`. These records are included in evidence downloads;
reuploads honor deletions unless the file explicitly includes a recreated group.
The additive legacy seed also honors the deletion record.

These four tables are outside the legacy upload/reset policy and are retained
by those operations. Transcript edits still update the existing `radio_clips`
table and follow that table's configured import policy. Apply the new schema
and additive seed to staging separately before using the new admin pages.

`radio_excerpts` imports the identity, page text, and transcript display
setting for each curated excerpt. `radio_excerpt_clips` links each excerpt to
its selected `radio_clips` in playback order. Each clip link also carries the
section and range position and section text, so the existing two-table design
preserves the current page grouping. Range endpoints are resolved against the
car-to-car manifest during import; missing boundaries, overlapping selections,
and missing clip references fail the rebuild.

`sources` imports each individual record from `data/sources/**/*.json` under
its existing `id` as `source_id`. The explicit `source_type` is `file`,
`external`, `youtube`, `news`, or `audio`. Common fields have their own columns:
label, URL or file path, publisher, channel, published date, description, and
duration. `source_file_path` records the JSON file used for this import. Rare
fields (such as `agency`, `providedBy`, and nested YouTube content) are retained
without loss in `extra_json`.

`entity_source_links` imports references from entity JSON that point to a
`sources.source_id`. It records the stable entity ID and type, JSON file, and
JSON pointer of each reference. `field_name` names the top-level entity field,
and `reference_json` preserves the complete reference, including any
`$override` or `$path`. Multiple references to the same source remain separate
rows when they appear in different places. References between entities are
excluded; entity IDs cannot yet have a foreign key until entity records have
their own table.
