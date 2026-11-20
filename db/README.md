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

To rebuild the SQLite database from tracked JSON, back up the existing remote
`afpd-data` D1 database, and replace the eight managed tables in D1:

```sh
make db-upload
```

The SQL import and a timestamped pre-upload D1 export are saved under ignored
`db/local/`. The command verifies the row count of each imported table. It
does not modify the repository or deploy the website. Any direct edits to
these eight D1 tables are overwritten by the rebuilt local data. The existing
database and its name are retained; a D1 binding is not added to `wrangler.jsonc`.
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

`sources` imports each individual record from `data/sources/**/*.json` under
its existing `id` as `source_id`. The explicit `source_type` is `file`,
`external`, `youtube`, `news`, or `audio`. Common fields have their own columns:
label, URL or file path, publisher, channel, published date, description, and
duration. `source_file_path` records the JSON file used for this import. Rare
fields (such as `agency`, `providedBy`, and nested YouTube content) are retained
without loss in `extra_json`. No entity-to-source links are imported yet.
