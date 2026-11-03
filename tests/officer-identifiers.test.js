import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const directoryProfiles = JSON.parse(fs.readFileSync("data/officer-call-sign-assignments.json", "utf8")).profiles;

test("every directory officer has a simple dated call-sign assignment table with working sources", () => {
  assert.equal(Object.keys(directoryProfiles).length, 58);
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
      assert.ok(panel.includes(assignment.assignment), slug);
      for (const source of assignment.sources) {
        assert.match(source.date, /^2026-(08-17|09-28)$/);
        assert.ok(panel.includes(`href="${source.url}"`), slug);
        assert.ok(source.label.includes(source.date.endsWith("09-28") ? "September 28, 2026" : "August 17, 2026"));
        assert.ok(fs.existsSync(`public${source.url.split("#")[0]}`));
      }
    }
  }
});

test("directory snapshots preserve reassigned call signs and do not invent unnamed assignments", () => {
  const dated = (slug, date) => directoryProfiles[slug].filter(row => row.sources.some(source => source.date === date)).map(row => row.call_sign);
  assert.deepEqual(dated("tanner-m-ballamis", "2026-08-17"), ["5J83"]);
  assert.deepEqual(dated("tanner-m-ballamis", "2026-09-28"), ["5J53"]);
  assert.deepEqual(dated("joshua-m-jensen", "2026-08-17"), ["5J27"]);
  assert.deepEqual(dated("joshua-m-jensen", "2026-09-28"), ["5J28"]);
  assert.deepEqual(dated("greg-b-mecham", "2026-08-17"), ["5J35"]);
  assert.deepEqual(dated("greg-b-mecham", "2026-09-28"), ["5J171"]);
  assert.deepEqual(dated("s-scott-daughrity", "2026-08-17"), ["5J170"]);
  assert.deepEqual(dated("s-scott-daughrity", "2026-09-28"), ["5J27"]);
  for (const date of ["2026-08-17", "2026-09-28"]) {
    const calls = Object.keys(directoryProfiles).flatMap(slug => dated(slug, date));
    assert.equal(calls.length, 58);
    assert.equal(new Set(calls).size, calls.length);
    assert.ok(!calls.includes("5J33"));
  }
});
