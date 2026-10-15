import assert from "node:assert/strict";
import test from "node:test";
import nunjucks from "nunjucks";
import { customTemplatePath } from "../lib/custom-template-path.js";

function render(nodes) {
  const env = new nunjucks.Environment(new nunjucks.FileSystemLoader("src/_includes"));
  env.addFilter("customTemplatePath", customTemplatePath);
  env.addFilter("formatArticleDate", value => value);
  return env.renderString('{% from "document-tree.njk" import renderNodes %}{{ renderNodes(nodes) }}', { nodes });
}

test("custom tree nodes render their data, escape text, and work inside folders", () => {
  const html = render([{ type: "folder", label: "Updates", contents: [{
    type: "custom", template: "latest-updates", heading: "News <unsafe>", headingLevel: 3,
    context: "Context <unsafe>", updates: [{ label: "Article <unsafe>", publisher: "Publisher", url: "https://example.com/", description: "Description <unsafe>" }]
  }] }]);
  assert.match(html, /<h3 class="latest-updates-heading">News &lt;unsafe&gt;<\/h3>/);
  assert.match(html, /Description &lt;unsafe&gt;/);
  assert.match(html, /https:\/\/example.com\//);
  assert.doesNotMatch(html, /<unsafe>/);
});

test("custom templates can render ordinary document-tree children", () => {
  const html = render([{ type: "custom", template: "explore-project", heading: "Resources", contents: [
    { type: "profile", label: "Officer", url: "/officers/example/" },
    { type: "text", text_value: "Supporting records" }
  ] }]);
  assert.match(html, /href="\/officers\/example\/"/);
  assert.match(html, /Supporting records/);
});

test("invalid or missing custom templates fail clearly rather than silently disappearing", () => {
  for (const template of ["../header", "/header", "latest-updates.njk", "", null]) {
    assert.throws(() => render([{ type: "custom", template }]), /Invalid custom template name/);
  }
  assert.throws(() => render([{ type: "custom", template: "does-not-exist" }]), /Custom template not found/);
});
