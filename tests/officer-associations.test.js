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
  assert.equal(compileOfficerAssociations(source(rows)).labels.associations["123"][0].status, "possible");
  assert.equal(compileOfficerAssociations(source(rows)).labels.associations["123"][0].evidence_days, 2);
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
    const dates = new Set(entry.filter(e => e.status !== "rejected").map(e => e.date));
    assert.equal(Number(row[3]), dates.size);
  }
  const halladay = result.labels.days["2026-10-30"]["14590221"][0];
  assert.equal(halladay.status, "confirmed");
  assert.equal(halladay.evidence_days, 4);
  assert.deepEqual(result.labels.associations["14590221"].filter(e => ["sammantha-j-halladay", "samuel-canizalez"].includes(e.officer_id)).map(e => [e.officer_id,e.status]), [["sammantha-j-halladay","strong"],["samuel-canizalez","possible"]]);
  const template = fs.readFileSync("src/police-radio-resources.njk", "utf8");
  assert.match(template, /officerCsv.rows/);
  assert.match(template, /afpd-radio-officer-ids.csv.*readCsv/);
});

test("invalid source fails the build instead of silently dropping evidence", () => {
  for (const extra of [{ officer_id: "missing" }, { clips: [0] }, { evidence: "" }, { status: "strong" }, { date: "2026-02-30" }]) {
    assert.throws(() => compileOfficerAssociations(source([record("2026-10-01", extra)])), /Invalid association/);
  }
});


test("review mode counts uncertain and conflicting dates without inventing owner confirmations", () => {
  const input = source([1,2,3].map(n => record(`2026-10-0${n}`, {status: "supporting",confirmed_by: null})));
  input.review_mode = "include-all"; input.withheld_dates = {"2026-10-01": ["123"]};
  input.associations.push(record("2026-10-01", {status: "supporting",officer_id: "two",confirmed_by: null}));
  input.associations.push(record("2026-10-02", {status: "supporting",officer_id: "two",confirmed_by: null}));
  input.associations.push(record("2026-10-03", {status: "supporting",officer_id: "two",confirmed_by: null}));
  const result = compileOfficerAssociations(input);
  assert.equal(result.labels.associations["123"].length, 2);
  assert.ok(result.labels.associations["123"].every(e => e.status === "possible" && e.evidence_days === 3));
  assert.equal(result.labels.days["2026-10-01"]["123"][0].status, "observed");
  assert.equal(result.labels.days["2026-10-01"]["123"][0].evidence[0].confirmed_by, null);
  assert.deepEqual(result.labels.withheld_dates, {});
  input.associations[0].status = "rejected";
  assert.equal(compileOfficerAssociations(input).labels.associations["123"].find(e => e.officer_id === "one").evidence_days, 2);
  assert.equal(compileOfficerAssociations(input).labels.associations["123"].find(e => e.officer_id === "one").status, "possible");
});

test("all workbook rows, old table pairs, conflicts, and same-clip alternatives survive the union", () => {
  const input = JSON.parse(fs.readFileSync("data/officer-association-evidence.json"));
  assert.equal(input.import_counts.workbook_exchange_ids, 366);
  assert.equal(new Set(input.associations.flatMap(r => r.provenance?.sheet === "Exchanges" ? r.evidence_ids : [])).size, 366);
  assert.equal(input.observations.length, 20);
  assert.equal(input.legacy_review_reports[0].candidate_reviews.length, 63);
  for (const officer of input.legacy_resource_entries) {
    const id = officer.url.split("/").filter(Boolean).at(-1);
    for (const radio of officer.ids) assert.ok(input.associations.some(r => r.officer_id === id && r.radio_id === radio.id), `${id}/${radio.id} lost`);
  }
  assert.ok(input.associations.some(r => r.officer_id === "anthony-s-neil" && r.radio_id === "14590027"));
  assert.ok(input.associations.some(r => r.officer_id === "delton-l-choates" && r.radio_id === "14590045"));
  const groups = Map.groupBy(input.associations.filter(r => r.candidate_group_id), r => r.candidate_group_id);
  let alternatives = 0;
  for (const records of groups.values()) {
    if (records.length < 2) continue;
    alternatives++;
    assert.equal(new Set(records.map(r => r.officer_id)).size, records.length);
    for (const row of records) {
      assert.equal(row.date, records[0].date);
      assert.deepEqual(row.clips, records[0].clips);
      assert.deepEqual(row.candidate_officer_ids, records[0].candidate_officer_ids);
      assert.equal(row.confirmed_by, null);
    }
  }
  assert.ok(alternatives >= 4);
});

test('completed owner evidence review counts selected Mason radio/date groups and retains excluded source rows as history',()=>{
 const result=buildOfficerAssociations();
 const mason=Object.entries(result.labels.associations).flatMap(([radio,rows])=>rows.filter(r=>r.officer_id==='brandon-k-mason').map(r=>[radio,r.evidence_days]));
 assert.deepEqual(mason,[['14590237',8],['14590315',15]]);
 assert.ok(!Object.values(result.labels.days['2026-10-23']??{}).flat().some(r=>r.officer_id==='brandon-k-mason'));
 assert.match(result.evidenceCsv,/historical context; not counted/);
 const source=JSON.parse(fs.readFileSync('data/officer-association-evidence.json'));
 assert.ok(source.associations.some(r=>r.record_id==='legacy-review-006'));
 assert.equal(source.associations.filter(r=>r.source==='owner_evidence_selection').length,23);
 assert.ok(source.associations.filter(r=>r.source==='owner_evidence_selection').every(r=>r.status==='supporting' && r.confirmed_by===null));
});
