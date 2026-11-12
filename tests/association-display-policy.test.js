import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {compileOfficerAssociations, buildOfficerAssociations} from '../lib/build-officer-associations.js';

const input = () => ({schema_version:1,officers:{one:{name:'One'},two:{name:'Two'}},associations:[]});
const row = (officer_id,date='2026-10-01',extra={}) => ({officer_id,radio_id:'123',date,talkgroup:6001,clips:[1,2],evidence:'Named exchange',status:'supporting',confirmed_by:null,...extra});
const reviewed = (officer,date) => row(officer,date,{association_reviewed:true});

test('include-all is rejected; repeated transcript candidates cannot create or strengthen any label',()=>{
  const source=input();source.associations=Array.from({length:20},(_,n)=>row('one',`2026-10-${String(n+1).padStart(2,'0')}`));
  const result=compileOfficerAssociations(source);
  assert.deepEqual(result.labels.associations,{});assert.deepEqual(result.labels.days,{});assert.deepEqual(result.labels.profiles,{});
  assert.match(result.evidenceCsv,/Named exchange/);
  source.review_mode='include-all';assert.throws(()=>compileOfficerAssociations(source),/no longer supported/);
});

test('two accepted possible associations coexist, and a strong association suppresses possible entries',()=>{
  const source=input();source.associations=['one','two'].flatMap(id=>[reviewed(id,'2026-10-01'),reviewed(id,'2026-10-02')]);
  let result=compileOfficerAssociations(source);
  assert.deepEqual(result.labels.associations['123'].map(r=>[r.officer_id,r.status]),[['one','possible'],['two','possible']]);
  source.associations.push(reviewed('one','2026-10-03'),reviewed('one','2026-10-04'));
  result=compileOfficerAssociations(source);
  assert.deepEqual(result.labels.associations['123'].map(r=>[r.officer_id,r.status]),[['one','strong']]);
  assert.equal(result.labels.profiles.two,undefined);assert.match(result.summaryCsv,/Lower-priority association; CSV only/);
});

test('day confirmation survives stronger general identities, holds, context exclusions, and owner evidence selection filters',()=>{
  const source=input();source.associations=[1,2,3,4].map(n=>reviewed('one',`2026-10-0${n}`));
  source.associations.push(row('two','2026-10-05',{record_id:'owner',status:'confirmed',confirmed_by:'Eric'}));
  source.withheld_dates={'2026-10-05':['123']};
  source.context_review_exclusions={records:{owner:{reason:'An older AI rejection'}}};
  source.owner_evidence_reviews={two:{active_record_ids:[]}};
  const result=compileOfficerAssociations(source);
  assert.deepEqual(result.labels.associations['123'].map(r=>r.officer_id),['one']);
  assert.deepEqual(result.labels.days['2026-10-05']['123'].map(r=>[r.officer_id,r.status]),[['two','confirmed']]);
  assert.equal(result.labels.days['2026-10-06'],undefined);
  assert.equal(result.labels.profiles.two[0].status_label,'Confirmed dates only');
  assert.equal(result.labels.associations['123'][0].confirmed,false);
});

test('an unreviewed contradiction never changes an existing general association or dated confirmation',()=>{
  const source=input();source.associations=[1,2,3,4].map(n=>reviewed('one',`2026-10-0${n}`));
  source.associations.push(row('one','2026-10-05',{status:'confirmed',confirmed_by:'Eric'}));
  const before=compileOfficerAssociations(source).labels;
  source.associations.push(...Array.from({length:20},(_,n)=>row('two',`2026-10-${String(n+1).padStart(2,'0')}`)));
  assert.deepEqual(compileOfficerAssociations(source).labels,before);
});

test('dated confirmations are not promoted to permanent pair confirmations',()=>{
  const source=input();source.associations=[row('one','2026-10-01',{status:'confirmed',confirmed_by:'Eric'})];
  const result=compileOfficerAssociations(source);
  assert.equal(result.labels.days['2026-10-01']['123'][0].status,'confirmed');
  assert.equal(result.labels.associations['123'][0].status,'possible');
  assert.equal(result.labels.associations['123'][0].confirmed,false);
  assert.equal(result.labels.associations['123'][0].evidence_days,1);
  assert.equal(result.labels.profiles.one[0].status_label,'Possible association');
  assert.equal(result.labels.days['2026-10-02'],undefined);
});

test('one-day fallback requires a confirmation and no reviewed competing identity',()=>{
  const source=input();
  source.associations=[reviewed('one','2026-10-01')];
  assert.equal(compileOfficerAssociations(source).labels.associations['123'],undefined);

  source.associations=[row('one','2026-10-01',{status:'confirmed',confirmed_by:'Eric'}),
    row('two','2026-10-02'),row('two','2026-10-03',{status:'rejected',association_reviewed:true})];
  assert.equal(compileOfficerAssociations(source).labels.associations['123'][0].status,'possible');

  source.associations.push(reviewed('two','2026-10-04'));
  let result=compileOfficerAssociations(source);
  assert.equal(result.labels.associations['123'],undefined);
  assert.equal(result.labels.days['2026-10-01']['123'][0].status,'confirmed');

  source.associations.push(row('two','2026-10-04',{status:'confirmed',confirmed_by:'Eric'}));
  result=compileOfficerAssociations(source);
  assert.equal(result.labels.associations['123'],undefined);
  assert.deepEqual(result.labels.days['2026-10-04']['123'].map(r=>r.officer_id),['two']);
});

test('all prior Eric confirmations and the Jackie correction remain, without the David/Somerville alternatives',()=>{
  const result=buildOfficerAssociations(),raw=JSON.parse(fs.readFileSync('data/officer-association-evidence.json'));
  for(const record of raw.associations.filter(r=>r.status==='confirmed' && r.confirmed_by==='Eric')) {
    assert.ok(result.labels.days[record.date]?.[record.radio_id]?.some(r=>r.officer_id===record.officer_id),record.record_id);
  }
  for(const date of ['2026-10-03','2026-10-04','2026-10-26']) assert.deepEqual(result.labels.days[date]['14590104'].map(r=>r.officer_id),['jaclyn-g-strong']);
  for(const [radio,id] of [['14590104','jaclyn-g-strong'],['14590073','j-tayler-somerville']]) assert.deepEqual(result.labels.associations[radio].map(r=>r.officer_id),[id]);
  for(const id of ['legacy-review-031','legacy-review-035','legacy-review-062','legacy-review-063']) {
    assert.ok(raw.associations.some(r=>r.record_id===id));assert.ok(result.evidenceCsv.includes(id));
  }
  assert.equal(result.labels.associations['14590114'][0].name,'Kyle B. Pitt');
  assert.equal(raw.review_mode,undefined);
});

test('added evidence cannot replace a retained general pair; a new confirmed day still overrides it',()=>{
 const source=input();source.display_policy={accepted_general_pairs:['one/123']};
 source.associations=[reviewed('one','2026-10-01'),reviewed('one','2026-10-02'),...[1,2,3,4].map(n=>reviewed('two',`2026-10-0${n}`))];
 source.associations.push(row('two','2026-10-05',{status:'confirmed',confirmed_by:'Eric'}));
 let result=compileOfficerAssociations(source);
 assert.deepEqual(result.labels.associations['123'].map(r=>[r.officer_id,r.status]),[['one','possible']]);
 assert.deepEqual(result.labels.days['2026-10-05']['123'].map(r=>r.officer_id),['two']);
 assert.equal(result.labels.profiles.two[0].general_eligible,false);
 assert.equal(result.labels.profiles.two[0].status_label,"Confirmed dates only");
 // If both general pairs are explicitly accepted, strength precedence applies.
 source.display_policy.accepted_general_pairs.push('two/123');
 result=compileOfficerAssociations(source);
 assert.deepEqual(result.labels.associations['123'].map(r=>[r.officer_id,r.status]),[['two','strong']]);
});
