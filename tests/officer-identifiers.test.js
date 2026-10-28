import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const labels = { "call-sign": "Call Sign", "ucjis-user-id": "UCJIS User ID", "radio-id": "Radio ID" };

test("built officer profiles keep each identifier in its own evidence table", () => {
  let profiles = 0;
  for (const file of fs.readdirSync("data/entities/people/officers")) {
    const officer = JSON.parse(fs.readFileSync(`data/entities/people/officers/${file}`, "utf8")).entities[0];
    if (!officer.observed_officer_ids?.length) continue;
    profiles++;
    const slug = file.replace(/\.json$/, "");
    const html = fs.readFileSync(`public/officers/${slug}/index.html`, "utf8");
    assert.match(html, /Observed Officer IDs/);
    assert.doesNotMatch(html, /Observed Agency IDs/);
    assert.match(html, /Officer Name: \[UCJIS ID\] - \[Full Name\]/);
    for (const [type, label] of Object.entries(labels)) {
      const observations = officer.observed_officer_ids.filter(row => row.type === type);
      const table = html.match(new RegExp(`aria-label="${label} observations and supporting evidence"[\\s\\S]*?<tbody>([\\s\\S]*?)</tbody>`));
      if (!observations.length) {
        assert.equal(table, null, `${slug}: no invented ${label} table`);
        assert.ok(html.includes(`No ${label} documented`));
        continue;
      }
      assert.ok(table, `${slug}: ${label} evidence table`);
      const ids = [...table[1].matchAll(/<th scope="row"><code>([^<]+)<\/code>/g)].map(match => match[1]);
      assert.deepEqual(ids, observations.map(row => row.id), `${slug}: ${label} contains only its own IDs`);
      for (const observation of observations) {
        if (!observation.url?.startsWith("/records/")) continue;
        assert.ok(fs.existsSync(`public${observation.url.split("#")[0]}`), `${slug}: source exists`);
      }
    }
  }
  assert.equal(profiles, 9);
});
