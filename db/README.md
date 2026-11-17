# Officer names preview

This is the local first phase of the D1 migration. The public 11ty build still
reads the existing JSON. Only the two-table schema and repeatable import script
are tracked; the generated SQLite file is ignored.

```sh
python3 db/import_officer_names.py
python3 db/import_officer_names.py --replace
```

`officers.id` is a stable numeric identity within this import, `url_slug` keeps
the existing profile address, and `display_name_id` selects one of that
officer's `officer_names` rows. Every explicitly listed canonical, alternate,
and search name is imported once per officer. There is no automatic generation
of middle-initial or shortened forms. The optional name parts are filled only
when the text has a simple, unambiguous form; `name_text` is always the exact
form to display or search. `kind = search_term` marks a query such as
"Officer Nye", not a personal name. `kind = radio_alias` stores specifically
confirmed standalone aliases. Unresolved radio cues are not assigned to an
officer.

`source_path` and `source_fields` indicate *which existing repository field*
was imported; they are not citations to the underlying original record.
The initial IDs are reproducible because source filenames and insertion order
are sorted. Once a remote database exists, its numeric IDs must be preserved
by incremental migrations rather than rebuilding from scratch.
