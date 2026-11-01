import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';
const context=vm.createContext({});vm.runInContext(fs.readFileSync('public/js/association-review-state.js','utf8'),context);
const Review=context.AFPDReviewState;
const payload={source:{officers:{one:{name:'One'},two:{name:'Two'}},associations:[{record_id:'original',officer_id:'one',radio_id:'123',date:'2026-10-01',talkgroup:6001,clips:[1],status:'supporting',evidence:'Uncertain original'}],review_leads:[{record_id:'lead',date:'2026-10-01',talkgroup:6001,clips:[1],status:'unassigned'}]},clips:{shared:{id:'shared',number:1,date:'2026-10-01',talkgroup:6001,transcript:'Original'},other:{id:'other',number:2,date:'2026-10-02',talkgroup:6001,transcript:'Other'}}};
const record={record_id:'original',officer_id:'one',radio_id:'123',date:'2026-10-01',talkgroup:6001,clip_ids:['shared']};
test('full export retains source, marks edits and selected confirmation evidence, and survives reload',()=>{
 const review=new Review(payload);review.state.reviewer='Eric';review.saveTranscript('shared','Corrected\n<literal text>','edit-time');review.confirm('original/one',record,'confirm-time');
 const reload=new Review(payload,JSON.parse(JSON.stringify(review.state))),out=reload.export('export-time');
 assert.equal(out.source.associations[0].evidence,'Uncertain original');assert.equal(out.source.associations[0].status,'supporting');
 assert.equal(out.source.associations[0].personal_reviews[0].confirmed_by,'Eric');
 assert.equal(out.clips.shared.original_transcript,'Original');assert.equal(out.clips.shared.transcript,'Corrected\n<literal text>');assert.equal(out.clips.shared.transcript_changed,true);
 assert.equal(out.clips.shared.confirmed_in_evidence.length,1);assert.equal(out.clips.other.confirmed_in_evidence.length,0);assert.equal(out.clips.other.transcript_changed,false);
 assert.equal(out.source.associations[0].evidence_transcript_changes.length,1);assert.equal(out.source.review_leads.length,1);
 reload.unconfirm('original/one');reload.saveTranscript('shared','Original');assert.equal(reload.export().confirmed_associations.length,0);assert.equal(reload.export().transcript_changes.length,0);
 assert.equal(payload.clips.shared.transcript,'Original');assert.equal(payload.source.associations[0].personal_reviews,undefined);
});
test('confirmation requires a reviewer, valid person, radio, and evidence from the correct date/channel',()=>{
 const review=new Review(payload);assert.throws(()=>review.confirm('key',record),/reviewer/);review.state.reviewer='Eric';
 for(const patch of [{radio_id:''},{officer_id:'unknown'},{clip_ids:[]},{clip_ids:['other']},{talkgroup:5922}]) assert.throws(()=>review.confirm('key',{...record,...patch}));
 review.saveTranscript('shared','Transcript correction');assert.equal(review.export().confirmed_associations.length,0);
});
test('restored edits report source changes rather than silently losing the original baseline',()=>{
 const review=new Review(payload);review.saveTranscript('shared','Mine');const changed=structuredClone(payload);changed.clips.shared.transcript='New source';
 const out=new Review(changed,review.state).export();assert.equal(out.transcript_changes[0].original_transcript,'Original');assert.equal(out.transcript_changes[0].source_changed_since_edit,true);assert.equal(out.clips.shared.transcript,'Mine');
});
test('merge retains every original record and treats all 733 new report hits as unassigned leads',()=>{
 const current=JSON.parse(fs.readFileSync('data/officer-association-evidence.json'));
 const original=JSON.parse(execFileSync('git',['show','fe0fc30658200b09ebfbf3853642f1201eb6b0da:data/officer-association-evidence.json'],{maxBuffer:10e6}));
 assert.deepEqual(current.associations,original.associations);assert.deepEqual(current.observations,original.observations);
 for(const [id,officer] of Object.entries(original.officers)) assert.deepEqual(current.officers[id],officer);
 assert.equal(current.review_leads.length,733);assert.equal(current.ai_reviews.length,363);
 assert.ok(current.review_leads.every(r=>r.status==='unassigned'&&!r.radio_id&&r.review_status==='pending'));
 assert.ok(current.review_leads.every(r=>!r.candidate_officer_ids.includes('philip-w-s-craig')));
 const richardson=current.review_leads.find(r=>r.report_id==='N012');assert.equal(richardson.talkgroup,5922);assert.ok(richardson.candidate_officer_ids.includes('cole-g-richardson'));
});

test('excluded former employees cannot be restored or newly confirmed; transcript edits survive',()=>{
 const payload={source:{officers:{former:{name:'Former Officer'}},excluded_candidates:{former:'Left before recordings'},associations:[]},clips:{c:{date:'2026-10-01',talkgroup:6001,transcript:'Original'}}};
 const saved={reviewer:'Eric',transcripts:{c:{text:'Edited',original_transcript:'Original'}},confirmations:{old:{confirmed:true,officer_id:'former',clip_ids:['c']}}};
 const state=new Review(payload,saved);
 assert.equal(Object.keys(state.state.confirmations).length,0);
 assert.equal(state.transcript('c'),'Edited');
 assert.throws(()=>state.confirm('new',{officer_id:'former',radio_id:'123',date:'2026-10-01',talkgroup:6001,clip_ids:['c']}),/eligible/);
});
