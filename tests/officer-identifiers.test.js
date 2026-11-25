import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import nunjucks from "nunjucks";

const directoryProfiles = JSON.parse(fs.readFileSync("data/officer-call-sign-assignments.json", "utf8")).profiles;

test("officer call-sign tables render the supplied assignments and source links", () => {
  for (const [slug, assignments] of Object.entries(directoryProfiles)) {
    const html = fs.readFileSync(`public/officers/${slug}/index.html`, "utf8");
    assert.match(html, /data-section-tab="observed-agency-ids"/);
    assert.doesNotMatch(html, /UCJIS User ID|About Call Signs/);
    const panel = html.match(/id="identifier-panel-call-sign"[\s\S]*?<\/section>/)?.[0];
    assert.ok(panel, slug);
    assert.match(panel, /<th scope="col">Call sign<\/th><th scope="col">Assignment<\/th><th scope="col">Source<\/th>/);
    assert.doesNotMatch(panel, /Date observed|Supporting evidence|<details/);
    assert.ok(panel.indexOf("Call signs can change or be reassigned.") < panel.indexOf("<table"));
    const ids = [...panel.matchAll(/<th scope="row"><code>([^<]+)<\/code>/g)].map(match => match[1]);
    assert.deepEqual(ids, assignments.map(row => row.call_sign), slug);
    for (const assignment of assignments) {
      assert.ok(panel.includes(nunjucks.lib.escape(assignment.assignment)), slug);
      for (const source of assignment.sources) {
        assert.ok(panel.includes(`href="${nunjucks.lib.escape(source.url)}"`), slug);
      }
    }
  }
});
