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
test('cleanup preserves prior sources and workbook exchanges and keeps retained leads unassigned',()=>{
 const current=JSON.parse(fs.readFileSync('data/officer-association-evidence.json'));
 const original=JSON.parse(execFileSync('git',['show','fe0fc30658200b09ebfbf3853642f1201eb6b0da:data/officer-association-evidence.json'],{maxBuffer:10e6}));
 const protectedRows = rows => rows.filter(r=>r.record_id.startsWith('prior-source-') || r.record_id.startsWith('workbook-'));
 assert.deepEqual(protectedRows(current.associations),protectedRows(original.associations));assert.deepEqual(current.observations,original.observations);
 assert.equal(current.associations.filter(r=>r.record_id.startsWith('prior-source-')).length,136);
 assert.equal(current.associations.filter(r=>r.source==='owner_listening_review').length,21);
 for(const [id,officer] of Object.entries(original.officers)) assert.deepEqual(current.officers[id],officer);
 assert.equal(current.review_leads.length,662);
 assert.ok(!current.review_leads.some(r=>r.report_id==='N234'));
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

test('context-rejected matches cannot return through saved confirmations; their recordings remain editable and exportable',()=>{
 const updated=structuredClone(payload);
 updated.source.context_review_exclusions={records:{original:{reason:'Civilian namesake'}}};
 const saved={reviewer:'Eric',transcripts:{shared:{text:'Edited',original_transcript:'Original'}},confirmations:{old:{...record,confirmed:true}}};
 const review=new Review(updated,saved);
 assert.equal(Object.keys(review.state.confirmations).length,0);
 assert.equal(review.transcript('shared'),'Edited');
 assert.throws(()=>review.confirm('new',record),/context review/);
 assert.equal(review.export().clips.shared.transcript,'Edited');
 assert.equal(review.export().source.associations.length,1);
});

test('per-person clip decisions survive reload and export without removing shared evidence',()=>{
 const input=structuredClone(payload);
 input.clip_selections=[{officer_id:'one',clip_id:'shared'},{officer_id:'two',clip_id:'shared'},{officer_id:'one',clip_id:'other'}];
 const review=new Review(input);review.state.reviewer='Eric';
 review.confirm('original/one',record);
 review.markClip('one','shared','removed','remove-time');
 review.markClip('two','shared','confirmed','confirm-time');
 assert.equal(Object.keys(review.state.confirmations).length,0);
 assert.throws(()=>review.confirm('original/one',record),/Restore removed/);
 const reload=new Review(input,JSON.parse(JSON.stringify(review.state))),out=reload.export();
 assert.equal(out.removed_clips.length,1);assert.equal(out.confirmed_clips.length,1);
 assert.equal(out.removed_clips[0].officer_id,'one');assert.equal(out.removed_clips[0].reviewed_at,'remove-time');
 assert.equal(out.confirmed_clips[0].officer_id,'two');assert.equal(out.confirmed_clips[0].reviewed_by,'Eric');
 assert.equal(out.clips.shared.personal_clip_reviews.length,2);assert.equal(out.clips.shared.transcript,'Original');
 assert.equal(out.clip_reviews.find(c=>c.clip_id==='other').status,'context');
 reload.markClip('one','shared','pending');reload.markClip('two','shared','pending');
 assert.equal(reload.export().removed_clips.length,0);assert.equal(reload.export().confirmed_clips.length,0);
 assert.throws(()=>reload.markClip('unknown','shared','removed'),/Unknown/);
 assert.throws(()=>reload.markClip('one','other','bad'),/Invalid/);
});

test('evidence checkbox overrides defaults per person, survives reload and retains every context clip',()=>{
 const input=structuredClone(payload);
 input.clip_selections=[{officer_id:'one',clip_id:'shared',evidence:true},{officer_id:'two',clip_id:'shared',evidence:true},{officer_id:'one',clip_id:'other',evidence:false}];
 const review=new Review(input);review.state.reviewer='Eric';
 assert.equal(review.evidenceSelected('one','shared'),true);assert.equal(review.evidenceSelected('one','other'),false);
 review.setEvidence('one','shared',false,'unchecked-time');review.setEvidence('one','other',true,'checked-time');
 const reload=new Review(input,JSON.parse(JSON.stringify(review.state))),out=reload.export();
 assert.equal(reload.evidenceSelected('one','shared'),false);assert.equal(reload.evidenceSelected('two','shared'),true);
 assert.equal(out.evidence_clips.length,2);assert.equal(out.context_clips.length,1);assert.equal(Object.keys(out.clips).length,2);
 assert.equal(out.removed_from_evidence_clips[0].clip_id,'shared');assert.equal(out.evidence_changes.length,2);
 assert.equal(out.evidence_changes[0].reviewed_at,'unchecked-time');assert.equal(out.evidence_changes[0].reviewed_by,'Eric');
 reload.setEvidence('one','shared',true);assert.equal(reload.export().context_clips.length,0);
 assert.throws(()=>reload.setEvidence('one','unknown',false),/Unknown/);
 assert.throws(()=>reload.setEvidence('one','shared','false'),/checked or unchecked/);
});

test('prior removals and confirmations migrate into checkbox choices and preserve history',()=>{
 const input=structuredClone(payload);
 input.clip_selections=[{officer_id:'one',clip_id:'shared',evidence:true},{officer_id:'two',clip_id:'shared',evidence:false}];
 const saved={reviewer:'Eric',clip_reviews:{'["one","shared"]':{officer_id:'one',clip_id:'shared',status:'removed',reviewed_at:'old-removal'},'["two","shared"]':{officer_id:'two',clip_id:'shared',status:'confirmed',reviewed_at:'old-confirmation'}}};
 const review=new Review(input,saved);
 assert.equal(review.evidenceSelected('one','shared'),false);assert.equal(review.evidenceSelected('two','shared'),true);
 review.setEvidence('one','shared',true);
 const reload=new Review(input,review.state);
 assert.equal(reload.evidenceSelected('one','shared'),true);
 assert.equal(reload.export().legacy_clip_reviews.find(c=>c.status==='removed').reviewed_at,'old-removal');
 assert.equal(reload.export().removed_clips.length,0);
});

test('unchecking evidence invalidates a dependent personal association without changing its original source',()=>{
 const input=structuredClone(payload);input.clip_selections=[{officer_id:'one',clip_id:'shared',evidence:true}];
 const saved={reviewer:'Eric',confirmations:{'original/one':{...record,confirmed:true,confirmed_by:'Eric',confirmed_at:'old-confirmation'}}};
 const review=new Review(input,saved);assert.equal(review.evidenceSelected('one','shared'),true);
 assert.equal(review.export().confirmed_associations.length,1);
 review.setEvidence('one','shared',false);
 const reload=new Review(input,review.state);assert.equal(reload.export().confirmed_associations.length,0);
 assert.equal(reload.export().source.associations[0].evidence,'Uncertain original');
});
