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

To rebuild a local SQLite snapshot from tracked JSON, back up the remote
`afpd-data` D1 database, and apply the per-table policy to the remote database:

```sh
make db-upload
```

To back up D1 and fully recreate every table from JSON, replacing any edits
saved only in D1, use `make db-reset D1_DATABASE=afpd-data-staging` for staging
or `make db-reset` for production. This keeps the Cloudflare database and its
binding IDs; it replaces the tables and rows inside it. An empty database can
also be initialized with either command.

`db/table-import-policy.json` specifies `recreate` or `insert_only` for **every**
table. The radio talkgroup, archive-day, and clip tables use `insert_only`,
preserving D1 transcript and verification edits in existing clips while adding
new rows from tracked JSON. Other tables currently use `recreate`, which drops
and rebuilds their rows from JSON. Existing-row changes in JSON do not update
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
