# Custom document-tree templates

Add a `custom` node anywhere the document tree accepts nodes, including a profile
section’s `contents` or the homepage’s `root.tree`:

```json
{
  "type": "custom",
  "template": "latest-updates",
  "heading": "Latest updates",
  "headingLevel": 3,
  "context": "Context for these updates",
  "updates": [{ "$ref": "existing-source-id" }]
}
```

`document-tree.njk` includes `src/_includes/custom/<template>.njk` and passes the
resolved object as `node`. Template names use lowercase letters, digits and
hyphens; missing or invalid names fail the build. Add a template in that folder
and its styles to `public/css/custom.css`; no new page-template branch is needed.
Escape text and attribute values in custom templates. Custom includes may call
`renderNodes(node.contents)` to render ordinary document-tree children.

Custom nodes may set `anchorId` to a unique, whitespace-free page anchor, such as
`"anchorId": "contact"`. The shared renderer adds this escaped value as the HTML
`id` on the custom node's list item, so links such as `href="#contact"` scroll to
that section without JavaScript. Keep `anchorId` separate from the data object's
`id`, which identifies it for `$ref` resolution. Existing folder nodes continue
to use their `anchor` field. Anchor values must be unique within a rendered page.

The homepage's `contact` custom node lives in `root.json`, after Explore the
Project. Its heading, paragraphs, and email address are data fields rendered by
`src/_includes/custom/contact.njk`.

The homepage Latest Updates object lives in
`data/entities/custom/home-latest-updates.json`. The Ben Schneider Overview references
`data/entities/custom/reckless-ben-latest-updates.json` with a heading-level and
profile-link override. Its article/video references resolve through the existing
entity/source resolver. `explore-project` wraps the homepage resource links.

Run `node --test tests/custom-templates.test.js` and `npm run build` after changes.
Commit the rebuilt `public` pages along with source changes, because the site
serves those generated files.
