import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const sharedProfiles=JSON.parse(fs.readFileSync("public/records/openmhz/officer-associations.json","utf8")).profiles;
const labels = { "call-sign": "Call Sign", "radio-id": "Radio ID" };

test("built officer profiles keep each identifier in its own evidence table", () => {
  let profiles = 0;
  for (const file of fs.readdirSync("data/entities/people/officers")) {
    const officer = JSON.parse(fs.readFileSync(`data/entities/people/officers/${file}`, "utf8")).entities[0];
    if (!officer.observed_officer_ids?.length) continue;
    profiles++;
    const slug = file.replace(/\.json$/, "");
    const html = fs.readFileSync(`public/officers/${slug}/index.html`, "utf8");
    const hasVisibleIdentifiers = officer.observed_officer_ids.some(row=>row.type==="call-sign") || (sharedProfiles[slug]??[]).length > 0;
    assert.equal(html.includes('data-section-tab="observed-agency-ids"'), hasVisibleIdentifiers, slug);
    assert.doesNotMatch(html, /UCJIS User ID|identifier-(?:tab|panel)-ucjis-user-id/);
    assert.doesNotMatch(html, /Observed Agency IDs/);
    for (const [type, label] of Object.entries(labels)) {
      const observations = type === "radio-id" ? (sharedProfiles[slug]??[]).map(row=>({id:row.radio_id})) : officer.observed_officer_ids.filter(row => row.type === type);
      const table = html.match(new RegExp(`aria-label="${label} observations and supporting evidence"[\\s\\S]*?<tbody>([\\s\\S]*?)</tbody>`));
      if (!observations.length) {
        assert.equal(table, null, `${slug}: no invented ${label} table`);
        if(type!=="ucjis-user-id")assert.ok(!html.includes(`<h3>${label}</h3>`));
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
