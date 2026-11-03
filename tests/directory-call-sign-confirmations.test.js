import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {isDatedConfirmation,isDirectoryCallSignDateConfirmation} from '../lib/association-display-policy.js';
import {compileOfficerAssociations} from '../lib/build-officer-associations.js';
import {loadAssociationEvidence} from '../lib/association-context-review.js';

const source=loadAssociationEvidence(process.cwd());
const rows=source.associations.filter(row=>row.source==='directory_callsign_crosscheck');
const directories=JSON.parse(fs.readFileSync('data/officer-call-sign-assignments.json','utf8')).profiles;

test('dated call-sign confirmations retain stable directory sources and matching three-pass metadata',()=>{
 assert.equal(rows.length,13);
 for(const row of rows){
  assert.equal(isDirectoryCallSignDateConfirmation(row),true,row.record_id);
  assert.equal(isDatedConfirmation(row),true,row.record_id);
  assert.notEqual(row.confirmed_by,'Eric');
  for(const date of ['2026-08-17','2026-09-28']) {
   const signs=new Set(directories[row.officer_id].filter(a=>a.sources.some(s=>s.date===date)).map(a=>a.call_sign));
   assert.deepEqual([...signs],[row.directory_call_sign_review.call_sign]);
  }
  const archive=JSON.parse(fs.readFileSync(`public/records/openmhz/openmhz-afpd-law-2-${row.date}/calls.json`,'utf8'));
  for(const check of row.directory_call_sign_review.clip_checks){
   const call=archive.calls[check.clip-1];
   assert.equal(call.id,check.id);assert.equal(call.sha256,check.sha256);
   assert.deepEqual(call.radio_ids,[row.radio_id]);
   assert.ok(call.srcList.every(transmitter=>String(transmitter.src)===row.radio_id));
   // Reconciliation may remove temporary checkpoints; copied pass text remains in the proof.
   if(!fs.existsSync(check.checkpoint))continue;
   const checkpoint=JSON.parse(fs.readFileSync(check.checkpoint,'utf8')).clips[call.original_filename];
   assert.equal(checkpoint.sha256,check.sha256);
   for(const pass of ['original','filtered','context'])assert.equal(checkpoint.passes[pass].text,check.passes[pass]);
  }
 }
});

test('incomplete or conflicting proof cannot create a dated confirmation',()=>{
 for(const edit of [
  row=>{row.directory_call_sign_review.clip_checks.pop();},
  row=>{row.directory_call_sign_review.clip_checks[0].passes.original='5J99, traffic.';},
  row=>{row.directory_call_sign_review.directory_sources=[];},
  row=>{row.directory_call_sign_review.audio_verified=true;},
  row=>{row.confirmed_by='AI';},
  row=>{row.association_reviewed=false;},
  row=>{row.production_date_conflict=true;}
 ]){
  const copy=structuredClone(rows[0]);edit(copy);assert.equal(isDatedConfirmation(copy),false);
 }
});

test('the new method adds one count per radio/officer/date and leaves older confirmations intact',()=>{
 const old=compileOfficerAssociations({...source,associations:source.associations.filter(row=>row.source!=='directory_callsign_crosscheck')}).labels;
 const result=compileOfficerAssociations(source).labels;
 const increments=new Map();
 for(const row of rows){
  const key=`${row.officer_id}/${row.radio_id}`;increments.set(key,(increments.get(key)??0)+1);
  assert.ok(result.days[row.date][row.radio_id].some(entry=>entry.officer_id===row.officer_id&&entry.status==='confirmed'));
 }
 for(const [key,increase] of increments){
  const [officer,radio]=key.split('/');
  const before=old.profiles[officer].find(row=>row.radio_id===radio);
  const after=result.profiles[officer].find(row=>row.radio_id===radio);
  assert.equal(after.evidence_days,before.evidence_days+increase,key);
 }
 for(const [date,radios] of Object.entries(old.days))for(const [radio,entries] of Object.entries(radios))for(const entry of entries)
  assert.ok(result.days[date][radio].some(next=>next.officer_id===entry.officer_id));
 const duplicated=compileOfficerAssociations({...source,associations:[...source.associations,...rows]}).labels;
 for(const key of increments.keys()){
  const [officer,radio]=key.split('/');
  assert.equal(duplicated.profiles[officer].find(row=>row.radio_id===radio).evidence_days,result.profiles[officer].find(row=>row.radio_id===radio).evidence_days);
 }
});
