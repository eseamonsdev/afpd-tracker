import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { compileOfficerAssociations, buildOfficerAssociations } from "../lib/build-officer-associations.js";
import { readCsv } from "../lib/data/read-csv.js";
const record = (date, extra = {}) => ({ officer_id: "one", radio_id: "123", date, talkgroup: 6001, clips: [1,2], evidence: 'Addressed by name, then replies. "Copy."', status: "confirmed", confirmed_by: "Eric", ...extra });
const source = associations => ({ schema_version: 1, officers: { one: { name: "One", heard: "One", url: "/officers/one/" }, two: { name: "Two", heard: "Two", url: "/officers/two/" } }, associations });

test("thresholds count distinct confirmed dates, never clips, records or talkgroups", () => {
  const rows = [record("2026-10-01"), record("2026-10-01", { talkgroup: 5922, clips: [3,4,5] })];
  let result = compileOfficerAssociations(source(rows));
  assert.equal(result.labels.days["2026-10-01"]["123"][0].status, "confirmed");
  assert.equal(result.labels.days["2026-10-01"]["123"][0].evidence_days, 1);
  assert.equal(result.labels.associations["123"], undefined);
  rows.push(record("2026-10-02"), record("2026-10-03", { status: "supporting" }));
  assert.equal(compileOfficerAssociations(source(rows)).labels.associations["123"], undefined);
  rows.push(record("2026-10-03"));
  assert.equal(compileOfficerAssociations(source(rows)).labels.associations["123"][0].status, "possible");
  rows.push(record("2026-10-04"));
  result = compileOfficerAssociations(source(rows));
  assert.equal(result.labels.associations["123"][0].status, "strong");
  assert.equal(result.labels.associations["123"][0].evidence_days, 4);
  assert.equal(result.labels.days["2026-10-01"]["123"][0].evidence[0].evidence, rows[0].evidence);
  assert.deepEqual(result.labels.days["2026-10-01"]["123"][0].evidence[0].clips, [1,2]);
});

test("holds suppress a date; each officer independently qualifies for the same radio", () => {
  const rows = [1,2,3,4,5].map(n => record(`2026-10-0${n}`));
  rows.push(...[1,2,3].map(n => record(`2026-10-0${n}`, { officer_id: "two" })));
  const input = source(rows); input.withheld_dates = { "2026-10-05": ["123"] };
  const result = compileOfficerAssociations(input);
  assert.deepEqual(result.labels.associations["123"].map(e => [e.name,e.status,e.evidence_days]), [["One","strong",4],["Two","possible",3]]);
  assert.equal(result.labels.days["2026-10-05"], undefined);
  assert.equal(result.labels.days["2026-10-01"]["123"].length, 2);
  rows.push(record("2026-10-04", {officer_id: "two"}));
  assert.ok(compileOfficerAssociations(input).labels.associations["123"].every(e => e.status === "strong"));
});

test("build exports CSV and labels from the same records with repeatable output", () => {
  const result = buildOfficerAssociations();
  const again = buildOfficerAssociations();
  assert.deepEqual(result, again);
  const table = readCsv("openmhz/afpd-radio-officer-ids.csv");
  for (const row of table.rows) {
    const input = JSON.parse(fs.readFileSync("data/officer-association-evidence.json"));
    const entry = input.associations.filter(e => e.radio_id === row[2] && input.officers[e.officer_id].name === row[1]);
    const dates = new Set(entry.filter(e => e.status === "confirmed" && !input.withheld_dates[e.date]?.includes(e.radio_id)).map(e => e.date));
    assert.equal(Number(row[3]), dates.size);
  }
  const halladay = result.labels.days["2026-10-30"]["14590221"][0];
  assert.equal(halladay.status, "confirmed");
  assert.equal(halladay.evidence_days, 1);
  assert.equal(result.labels.associations["14590221"], undefined);
  const template = fs.readFileSync("src/police-radio-resources.njk", "utf8");
  assert.match(template, /officerCsv.rows/);
  assert.match(template, /afpd-radio-officer-ids.csv.*readCsv/);
});

test("invalid source fails the build instead of silently dropping evidence", () => {
  for (const extra of [{ officer_id: "missing" }, { clips: [0] }, { evidence: "" }, { status: "strong" }, { date: "2026-02-30" }]) {
    assert.throws(() => compileOfficerAssociations(source([record("2026-10-01", extra)])), /Invalid association/);
  }
});
