import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { compileOfficerAssociations, buildOfficerAssociations } from "../lib/build-officer-associations.js";
import { withProductionAssociationBaseline } from "../lib/production-association-baseline.js";
import { filterAssociationContext, loadAssociationEvidence } from "../lib/association-context-review.js";
import { isDatedConfirmation } from "../lib/association-display-policy.js";
import { readCsv } from "../lib/data/read-csv.js";
const record = (date, extra = {}) => ({ officer_id: "one", radio_id: "123", date, talkgroup: 6001, clips: [1,2], evidence: 'Addressed by name, then replies. "Copy."', status: "confirmed", confirmed_by: "Eric", ...extra });
const source = associations => ({ schema_version: 1, officers: { one: { name: "One", heard: "One", url: "/officers/one/" }, two: { name: "Two", heard: "Two", url: "/officers/two/" } }, associations });

test("thresholds count distinct confirmed dates, never clips, records or talkgroups", () => {
  const rows = [record("2026-10-01"), record("2026-10-01", { talkgroup: 5922, clips: [3,4,5] })];
  let result = compileOfficerAssociations({...source(rows), association_confirmations:{"one/123":{confirmed:false}}});
  assert.equal(result.labels.days["2026-10-01"]["123"][0].status, "confirmed");
  assert.equal(result.labels.days["2026-10-01"]["123"][0].evidence_days, 1);
  assert.equal(result.labels.associations["123"], undefined);
  rows.push(record("2026-10-02"), record("2026-10-03", { status: "supporting" }));
  assert.equal(compileOfficerAssociations({...source(rows), association_confirmations:{"one/123":{confirmed:false}}}).labels.associations["123"][0].status, "possible");
  assert.equal(compileOfficerAssociations({...source(rows), association_confirmations:{"one/123":{confirmed:false}}}).labels.associations["123"][0].evidence_days, 2);
  rows.push(record("2026-10-03"));
  assert.equal(compileOfficerAssociations({...source(rows), association_confirmations:{"one/123":{confirmed:false}}}).labels.associations["123"][0].status, "possible");
  rows.push(record("2026-10-04"));
  result = compileOfficerAssociations({...source(rows), association_confirmations:{"one/123":{confirmed:false}}});
  assert.equal(result.labels.associations["123"][0].status, "strong");
  assert.equal(result.labels.associations["123"][0].evidence_days, 4);
  assert.equal(result.labels.days["2026-10-01"]["123"][0].evidence[0].evidence, rows[0].evidence);
  assert.deepEqual(result.labels.days["2026-10-01"]["123"][0].evidence[0].clips, [1,2]);
});

test("explicit dated confirmations survive historical holds and general strength never mixes possible with strong", () => {
  const rows = [1,2,3,4,5].map(n => record(`2026-10-0${n}`));
  rows.push(...[1,2,3].map(n => record(`2026-10-0${n}`, { officer_id: "two" })));
  const input = source(rows); input.withheld_dates = { "2026-10-05": ["123"] };
  const result = compileOfficerAssociations(input);
  assert.deepEqual(result.labels.associations["123"].map(e => [e.name,e.status,e.evidence_days]), [["One","strong",5]]);
  assert.equal(result.labels.days["2026-10-05"]["123"][0].status,"confirmed");
  assert.equal(result.labels.days["2026-10-01"]["123"].length,2);
});

test("build exports CSV and labels from the same records with repeatable output", () => {
  const result = buildOfficerAssociations();
  const again = buildOfficerAssociations();
  assert.deepEqual(result, again);
  const table = readCsv("openmhz/afpd-radio-officer-ids.csv");
  for (const row of table.rows) {
    const input = filterAssociationContext(withProductionAssociationBaseline(loadAssociationEvidence(process.cwd())));
    const entry = input.associations.filter(e => e.radio_id === row[2] && input.officers[e.officer_id].name === row[1] && (e.production_baseline || isDatedConfirmation(e) || !input.owner_evidence_reviews?.[e.officer_id] || input.owner_evidence_reviews[e.officer_id].active_record_ids.includes(e.record_id)));
    const dates = new Set(entry.filter(e => e.status !== "rejected" && (e.association_reviewed === true || e.status === "confirmed" && e.confirmed_by === "Eric")).map(e => e.date));
    assert.equal(Number(row[3]), dates.size);
  }
  const halladay = result.labels.days["2026-10-30"]["14590221"][0];
  assert.equal(halladay.status, "confirmed");
  assert.equal(halladay.evidence_days, 4);
  assert.equal(result.labels.associations["14590221"][0].status, "strong");
  const template = fs.readFileSync("src/police-radio-resources.njk", "utf8");
  assert.match(template, /officerCsv.rows/);
  assert.match(template, /afpd-radio-officer-ids.csv.*readCsv/);
});

test("invalid source fails the build instead of silently dropping evidence", () => {
  for (const extra of [{ officer_id: "missing" }, { clips: [0] }, { evidence: "" }, { status: "strong" }, { date: "2026-02-30" }]) {
    assert.throws(() => compileOfficerAssociations(source([record("2026-10-01", extra)])), /Invalid association/);
  }
});


test("conflicting unconfirmed candidates remain in CSV without becoming display labels", () => {
  const input = source([1,2,3].flatMap(n => ["one","two"].map(officer_id => record(`2026-10-0${n}`, {officer_id,status:"supporting",confirmed_by:null}))));
  const result = compileOfficerAssociations(input);
  assert.equal(result.labels.associations["123"],undefined);
  assert.deepEqual(result.labels.days,{});
  assert.deepEqual(result.labels.profiles,{});
  assert.match(result.evidenceCsv,/Unreviewed or insufficient evidence; CSV only/);
  assert.match(result.summaryCsv,/One/);
  assert.match(result.summaryCsv,/Two/);
});

test("all workbook rows, old table pairs, conflicts, and same-clip alternatives survive the union", () => {
  const input = JSON.parse(fs.readFileSync("data/officer-association-evidence.json"));
  assert.equal(input.import_counts.workbook_exchange_ids, 366);
  assert.equal(new Set(input.associations.flatMap(r => r.provenance?.sheet === "Exchanges" ? r.evidence_ids : [])).size, 366);
  assert.equal(input.observations.filter(r => !r.officer_id).length, 20);
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
 // Includes the later Law 2 and November 2 dated confirmations.
 assert.deepEqual(mason,[['14590237',11],['14590315',16]]);
 for (const radio of ['14590237','14590315']) {
  assert.equal(result.labels.days['2026-11-02'][radio].find(r=>r.officer_id==='brandon-k-mason').status,'confirmed');
 }
 assert.ok(!Object.values(result.labels.days['2026-10-23']??{}).flat().some(r=>r.officer_id==='brandon-k-mason'));
 assert.match(result.evidenceCsv,/historical context; not counted/);
 const source=JSON.parse(fs.readFileSync('data/officer-association-evidence.json'));
 assert.ok(source.associations.some(r=>r.record_id==='legacy-review-006'));
 assert.equal(source.associations.filter(r=>r.source==='owner_evidence_selection').length,23);
 assert.ok(source.associations.filter(r=>r.source==='owner_evidence_selection').every(r=>r.status==='supporting' && r.confirmed_by===null));
});

test('Sam first-name alternatives do not count as two identities and owner confirmations override only matching exchanges', async () => {
 const {resolveSamIdentities}=await import('../lib/association-context-review.js');
 const halladay='sammantha-j-halladay', canizalez='samuel-canizalez';
 const input={...source([]),officers:{[halladay]:{name:'Halladay'},[canizalez]:{name:'Canizalez'}}};
 const alternative=(officer_id,date,clips=[1,2])=>record(date,{officer_id,clips,record_id:`${date}-${officer_id}`,candidate_group_id:date,candidate_officer_ids:[halladay,canizalez],status:'supporting',confirmed_by:null});
 input.associations=[alternative(halladay,'2026-10-01'),alternative(canizalez,'2026-10-01'),
  record('2026-10-01',{officer_id:halladay,record_id:'owner',confirmed_by:'Eric'}),
  ...[2,3,4].flatMap(n=>[alternative(halladay,`2026-10-0${n}`),alternative(canizalez,`2026-10-0${n}`)])];
 input.review_leads=[{...alternative(canizalez,'2026-10-01'),record_id:'known-lead'},
  {...alternative(canizalez,'2026-10-02'),record_id:'unknown-lead'}];
 const resolved=resolveSamIdentities(input);
 assert.deepEqual(resolved.associations.map(r=>r.officer_id),[halladay,halladay]);
 assert.ok(resolved.review_leads.every(r=>r.candidate_officer_ids.length===1&&r.candidate_officer_ids[0]===halladay));
 assert.equal(resolved.observations.length,3);
 assert.ok(resolved.observations.every(r=>!r.radio_id&&!r.confirmed_by));
 assert.deepEqual(resolveSamIdentities(resolved),resolved);
 const compiled=compileOfficerAssociations(input);
 assert.equal(compiled.labels.profiles[halladay][0].evidence_days,1);
 assert.equal(compiled.labels.profiles[canizalez],undefined);
 assert.equal(compiled.labels.associations['123'],undefined);
 assert.match(compiled.evidenceCsv,/Unresolved Sam identity; not counted/);
});

test('historical Sam voice identifications survive while 14590221 shared-name dates remain unassigned',()=>{
 const result=buildOfficerAssociations();
 const h='sammantha-j-halladay',s='samuel-canizalez';
 for(const [date,radio,id] of [['2026-09-24','14590100',h],['2026-10-07','14590067',h],['2026-10-08','14590067',h],['2026-09-28','14590090',s],['2026-09-28','14590066',s],['2026-10-07','14590268',s],['2026-10-30','14590221',h],['2026-10-17','14590221',h]]) {
  const entries=result.labels.days[date][radio];
  const own=entries.find(r=>r.officer_id===id);
  assert.equal(own.status,'confirmed');
  assert.ok(own.evidence.some(r=>r.confirmed_by==='Eric'));
  assert.ok(!entries.some(r=>r.officer_id===(id===h?s:h)));
 }
 assert.equal(result.labels.profiles[h].find(r=>r.radio_id==='14590221').evidence_days,4);
 assert.ok(!result.labels.profiles[s].some(r=>r.radio_id==='14590221'));
 for(const date of ['2026-09-20','2026-10-13'])assert.ok(!result.labels.days[date]?.['14590221']?.some(r=>[h,s].includes(r.officer_id)));
});


test("owner-accepted Neil evidence leaves unassigned leads and generates the correct radio rows",()=>{
 const source=loadAssociationEvidence(process.cwd());
 const ids=["N252","N319","N362","N504","N592","N605"];
 assert.ok(!source.review_leads.some(r=>ids.includes(r.report_id)));
 const result=compileOfficerAssociations(source);
 const neil=result.labels.profiles["anthony-s-neil"];
 assert.equal(neil.length,1);
 assert.equal(neil[0].radio_id,"14590027");
 assert.equal(neil[0].evidence_days,6);
 assert.deepEqual(neil[0].evidence_dates,['2026-09-14','2026-09-15','2026-09-20','2026-09-23','2026-10-03','2026-10-30']);
 assert.ok(result.labels.days['2026-10-30']['14590027'].some(r=>r.officer_id==='anthony-s-neil' && r.evidence.some(e=>e.confirmed_by==='Eric' && e.clips.includes(304))));
 assert.ok(result.labels.days["2026-10-03"]["14590027"].some(r=>r.officer_id==="anthony-s-neil" && r.evidence.some(e=>e.clips.includes(91) && e.clips.includes(92))));
 assert.equal(neil[0].confirmed,false);
 assert.equal(result.labels.associations["14590268"]?.some(r=>r.officer_id==="anthony-s-neil")??false,false);
 const mention=source.observations.find(r=>r.report_id==="N605");
 assert.equal(mention.officer_id,"anthony-s-neil");
 assert.equal(mention.radio_id,undefined);
 assert.match(result.evidenceCsv,/"anthony-s-neil","","2026-10-03"/);
});
