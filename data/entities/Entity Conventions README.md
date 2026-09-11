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
law-enforcement-officer
civilian
civilian-employee
```

Example:

```json
{
  "id": "entity-person-shawn-lott",
  "type": "person",
  "roles": [
    "law-enforcement-officer"
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
  "$field": "post_discipline_sources",
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