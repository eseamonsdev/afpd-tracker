import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {buildOfficerAssociations,compileOfficerAssociations} from '../lib/build-officer-associations.js';

const baseline=JSON.parse(fs.readFileSync('data/production-officer-association-baseline.json'));
test('all production strong pairs and their evidence dates survive, including the legacy unresolved label',()=>{
 const result=buildOfficerAssociations().labels;
 const entries=Object.entries(baseline.associations).flatMap(([radio,rows])=>rows.map(row=>({radio,...row})));
 assert.equal(entries.length,29);
 for(const original of entries) {
  const current=result.associations[original.radio]?.find(row=>row.officer_id===original.officer_id);
  assert.equal(current?.status,'strong',`${original.radio}/${original.officer_id}`);
  assert.ok(current.evidence_days>=original.evidence_days);
  for(const date of original.evidence_dates)assert.ok(current.evidence_dates.includes(date));
 }
});
test('every production confirmed officer/radio/date entry survives with its original attribution',()=>{
 const result=buildOfficerAssociations().labels;let count=0;
 for(const [date,radios] of Object.entries(baseline.days))for(const [radio,rows]of Object.entries(radios))for(const original of rows) {
  count++;
  const current=result.days[date]?.[radio]?.find(row=>row.officer_id===original.officer_id);
  assert.equal(current?.status,'confirmed',`${date}/${radio}/${original.officer_id}`);
  for(const evidence of original.evidence??[])assert.ok(current.evidence.some(row=>row.evidence===evidence.evidence && row.confirmed_by===(evidence.confirmed_by??null)));
 }
 assert.equal(count,113);
});
test('a new conflicting dated assertion cannot replace or join a protected production identity',()=>{
 const original={officer_id:'one',name:'One',status:'confirmed',evidence:[{talkgroup:6001,clips:[1],evidence:'Original production confirmation',confirmed_by:null}]};
 const source={schema_version:1,officers:{one:{name:'One'},two:{name:'Two'}},associations:[{officer_id:'two',radio_id:'123',date:'2026-10-01',talkgroup:6001,clips:[2],evidence:'New competing assertion',status:'confirmed',confirmed_by:'Eric'}],production_association_baseline:{schema_version:1,associations:{},days:{'2026-10-01':{'123':[original]}}}};
 const result=compileOfficerAssociations(source);
 assert.deepEqual(result.labels.days['2026-10-01']['123'].map(row=>row.officer_id),['one']);
 assert.match(result.evidenceCsv,/New competing assertion/);
});
