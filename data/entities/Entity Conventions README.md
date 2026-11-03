# Entity Conventions

This directory contains structured entities used by the AFPD Tracker.

Entities represent real-world people, agencies, cases, incidents, disciplinary matters, and other concepts that may reference one or more underlying sources.

## General Structure

Entity JSON files use a top-level `entities` array:

```json
{
  "entities": [
    {
      "id": "entity-person-shawn-lott",
      "type": "person"
    }
  ]
}
```

A file may contain one entity or multiple related entities.

Large or frequently edited entities should generally have their own JSON file. Smaller related entities may be grouped together in the same file.

## Entity IDs

Entity IDs should begin with:

```text
entity-
```

Use a singular entity type after the prefix.

Examples:

```text
entity-person-shawn-lott
entity-person-joseph-ferreri
entity-agency-american-fork-police-department
entity-case-joseph-ferreri-211400304
entity-incident-ben-schneider-26af02007
entity-discipline-christian-connelly-2024-12-09
```

Entity IDs must be globally unique across all loaded data.

## Person Entities

All human beings should use:

```json
"type": "person"
```

Roles should describe how the person relates to the tracker.

Current person roles:

```text
city-official
officer
civilian
civilian-employee
```

Example:

```json
{
  "id": "entity-person-shawn-lott",
  "type": "person",
  "roles": [
    "officer"
  ]
}
```

Another example:

```json
{
  "id": "entity-person-joseph-ferreri",
  "type": "person",
  "roles": [
    "civilian"
  ]
}
```

Roles may contain more than one value when appropriate.

### Officer Agency IDs

Store a confirmed agency identifier as an optional `agency_id` string on the
officer's person entity, for example `"agency_id": "5J42"`. Keep it separate
from `name` and from radio device IDs.

Reference that field on the corresponding officer-page entity:

```json
"agency_id": {
  "$ref": "entity-person-cole-g-richardson",
  "$path": ["agency_id"]
}
```

The officer profile heading displays a nonblank ID in parentheses after the
name. Omit the page reference when the person has no confirmed ID; profiles
without an ID keep their existing headings.

## Sources vs. Entities

`data/sources/` contains independently citable or retrievable materials, such as:

- files
- court records
- public-record deliverables
- news articles
- videos
- external URLs

`data/entities/` contains structured information that connects those sources to real-world people, cases, agencies, incidents, and other concepts.

A source should generally represent one actual source or deliverable.

An entity may reference many sources.

## References

Use `$ref` to reference another indexed object:

```json
{
  "$ref": "some-id"
}
```

Use `$override` when the same source should have different presentation information in a particular context:

```json
{
  "$ref": "utah-post-council-minutes-2025-09-16",
  "$override": {
    "label": "POST Council Minutes — Jacob W. Hager Disciplinary Case — September 16, 2025"
  }
}
```

Use `$spread: true` when a referenced array should be inserted as individual items into a surrounding array rather than as a nested array.

Example:

```json
{
  "$ref": "entity-person-christian-connelly",
  "$path": ["post_discipline_sources"],
  "$spread": true
}
```

## Field Names

Fields inside entities do not need to be globally unique.

For example, many entities may contain:

```text
sources
employment
cases
discipline
```

Only entity IDs and other indexed object IDs must be globally unique.

## Profile Tabs

Sections on officer, civilian employee, city official, and police encounter pages
must have an explicit, stable kebab-case `id`, unique within that page:

```json
{
  "id": "criminal-cases",
  "title": "Criminal Cases",
  "contents": []
}
```

Link directly to a tab with `?tab=criminal-cases` appended to the profile URL.
Selecting a tab updates the URL; browser Back and Forward restore the selection.
A missing, unknown, or unpublished tab opens the first published tab.
Keep the ID unchanged when renaming or reordering a tab, including unpublished
tabs. Builds reject missing, invalid, or duplicate IDs on these four page types.

## Profile Photos

City official page entities can supply an optional `photo` object:

```json
"photo": {
  "src": "/records/american-fork-city/city-official-photos/brad-frost-photo.jpg",
  "width": 400,
  "height": 600,
  "download_date": "2026-11-02",
  "source_url": "https://www.americanfork.gov/ImageRepository/Document?documentID=5660",
  "source_page_url": "https://www.americanfork.gov/678/Mayor-City-Council",
  "position": "center top"
}
```

`width` and `height` are the original image dimensions. The reusable
`profile-photo.njk` macro displays a responsive 4:5 portrait without stretching
the image. Cropping defaults to `center top` to keep faces visible; optional
`position` overrides CSS `object-position` for a particular photo. Clicking the
photo opens the original image. Optional `alt` overrides the default portrait
description. Omit `photo` for officials without one; no empty frame is rendered.

`download_date` records the date the saved image was originally downloaded, in
`YYYY-MM-DD` format. `source_url` is the direct original image download URL;
`source_page_url` is the page that publishes and identifies the image. These
fields document provenance and do not indicate a reuse license.

Other profile templates can import `renderProfilePhoto(photo, name)` and load
`/css/profile-photo.css` to reuse the same component.
