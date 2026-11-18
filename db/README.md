# Officer and radio database preview

This is a local preview for a possible D1 migration. The public 11ty build still
reads the existing JSON. The schema and repeatable importer are tracked; the
generated SQLite file is ignored.

```sh
python3 db/import_officer_names.py
python3 db/import_officer_names.py --replace
```

To inspect the two tables in a browser, start the read-only local viewer:

```sh
python3 db/serve.py
```

Open `http://127.0.0.1:8765/db/`. The viewer runs only on your computer
and can search, paginate, and open an officer's associated names. Stop it
with Ctrl+C. After changing the source JSON, rerun the import with
`--replace` and refresh the viewer.

An optional local static snapshot can be exported to `public/db/` from these
same local tables. This generated directory is ignored by Git and is not
committed to staging or main. To generate it after editing officer JSON:

```sh
python3 db/import_officer_names.py --replace
python3 db/export_static.py
```

The exporter also writes compressed `public/db/radio/*.bin` in small date ranges. The
viewer loads radio rows by archive month and optionally talkgroup, so opening
the page does not download every clip at once. Keep this export local.
Remove `public/db/` before a manual deployment if you have generated it locally;
`make promote-staging` also blocks promotion if those files become tracked.
The live site still reads its existing JSON; the database has not been moved
to D1 yet.

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
archives into `radio_talkgroups`, `radio_ids`, `radio_clips`, and
`radio_clip_sources`. `radio_clips.id` is the OpenMHz call ID and
`(system, talkgroup_number, archive_date, clip_number)` identifies a clip in
the day archive. The audio reference is the R2 key and its recorded checks;
the audio bytes remain in R2. Expiring OpenMHz media and call URLs are not
imported. A clip may have zero or several identified radio sources, and a
radio ID does not imply a permanent officer assignment. The current and
original transcript, review flags, timestamps, and audio metadata are
available in the read-only viewer. Officer association decisions and callsign
assignments remain in their existing JSON for now.
