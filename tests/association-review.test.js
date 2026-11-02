import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {clipDialogueEvidence,filterAssociationContext,loadAssociationEvidence} from "../lib/association-context-review.js";
import {selectAssociationReview, renderAssociationReview, buildAssociationReview} from "../lib/build-association-review.js";
const source = {officers:{one:{name:"First Officer"},two:{name:"Second Officer"}}, associations:[]};
const record = (officer_id,date,clips,extra={})=>({officer_id,date,clips,talkgroup:6001,status:"supporting",radio_id:"123",evidence:"Original uncertainty",...extra});
const manifest = (date,talkgroup=6001)=>({date,talkgroup,calls:[{epoch:200,original_filename:`dcfems-${talkgroup}-200.m4a`,transcript:"Second"},{epoch:100,original_filename:`dcfems-${talkgroup}-100.m4a`,transcript:"First"}]});

test("review groups every candidate separately, orders dates and clips, deduplicates within a day, and retains both talkgroups",()=>{
 const input={...source,associations:[record("one","2026-10-02",[2,1]),record("one","2026-10-02",[1]),record("two","2026-10-02",[1]),record("one","2026-10-01",[1]),record("one","2026-10-03",[]),record("two","2026-10-04",[1],{talkgroup:5922}),record("two","2026-10-05",[1],{status:"rejected"})]};
 const result=selectAssociationReview(input,manifest);
 assert.equal(result.people.length,2);assert.equal(result.personDays,5);assert.equal(result.selections,6);
 assert.deepEqual(result.people[0].days.map(d=>d.date),["2026-10-01","2026-10-02"]);
 assert.deepEqual(result.people[0].days[1].calls.map(c=>[c.number,c.transcript]),[[1,"First"],[2,"Second"]]);
 assert.equal(result.people[1].days[0].calls[0].number,1);
 assert.throws(()=>selectAssociationReview({...source,associations:[record("one","2026-10-01",[3])]},manifest),/Missing 6001 clip/);
 assert.throws(()=>selectAssociationReview({...source,associations:[record("one","2026-10-01",[1])]},manifest,()=>false),/Audio unavailable/);
});

test("HTML preserves source uncertainty, uses one compact player per person, and preloads no audio",()=>{
 const input={...source,associations:[record("one","2026-10-01",[1],{evidence:'<script>unsafe</script>',name_heard:'"First?"',candidate_officer_ids:["one","two"]})]};
 const html=renderAssociationReview(selectAssociationReview(input,manifest),input,"body{}","test()");
 const payload=JSON.parse(html.match(/<script type="application\/json" id="review-data">([\s\S]*?)<\/script>/)[1]);
 assert.equal(payload.source.associations[0].evidence,"<script>unsafe</script>");assert.ok(!html.includes("<script>unsafe</script>"));
 assert.match(html,/<audio preload="none"/);assert.match(html,/data-action="show-current"/);assert.match(html,/data-seek/);assert.match(html,/data-speed/);
 assert.ok(!html.includes('data-action="previous"'));assert.ok(!html.includes("data-autoplay"));
 assert.match(html,/noindex, nofollow/);assert.match(html,/data-transcript="First"/);
});

test("real review includes both talkgroups, AI context and the full export payload",()=>{
 const input=JSON.parse(fs.readFileSync("data/officer-association-evidence.json","utf8"));
 const result=buildAssociationReview();
 assert.ok(result.days>500);assert.ok(result.uniqueClips>4000);
 const html=fs.readFileSync(result.output,"utf8");
 assert.equal((html.match(/data-day /g)||[]).length,result.days);
 assert.equal((html.match(/class="clip"/g)||[]).length,result.clips);
 assert.ok(html.includes("dcfems-5922-"));assert.ok(html.includes("Anthony S. Neil"));
 assert.match(html,/id="export-review"/);assert.match(html,/data-clip-evidence/);assert.match(html,/data-action="edit-transcript"/);assert.match(html,/Personal verification/);
 const payload=JSON.parse(html.match(/<script type="application\/json" id="review-data">([\s\S]*?)<\/script>/)[1]);
 const filtered=filterAssociationContext(loadAssociationEvidence(process.cwd()));
 assert.equal(payload.source.associations.length,filtered.associations.length);assert.equal(payload.source.review_leads.length,filtered.review_leads.length);assert.equal(Object.keys(payload.clips).length,result.uniqueClips);
 assert.match(html,/https:\/\/media\.afpd-accountability\.com\/openmhz\//);
 const ids=[...html.matchAll(/\sid="([^"]+)"/g)].map(m=>m[1]);assert.equal(ids.length,new Set(ids).size);
});

test("employment exclusions remove identities from headings, choices and labels while retaining original evidence and audio for export", async()=>{
 const input={...source,excluded_candidates:{one:"Left before recordings"},associations:[record("one","2026-10-01",[1])],review_leads:[{record_id:"lead",date:"2026-10-02",talkgroup:6001,clips:[2],candidate_officer_ids:["one","two"],evidence:"Unresolved cue"}]};
 const review=selectAssociationReview(input,manifest);
 assert.deepEqual(review.people.map(p=>p.id),["two"]);
 assert.equal(Object.keys(review.clipCatalog).length,2);
 const html=renderAssociationReview(review,input,"","");
 const visible=html.split('<script type="application/json"')[0];
 assert.ok(!visible.includes("First Officer"));
 assert.ok(!visible.includes('value="one"'));
 const {compileOfficerAssociations}=await import('../lib/build-officer-associations.js');
 const labels=compileOfficerAssociations({...input,schema_version:1});
 assert.deepEqual(labels.labels.days,{});
 assert.ok(!labels.summaryCsv.includes("First Officer"));
});

test("rejected civilian matches never enter the player, clip catalog or CSV-derived day counts", async()=>{
 const input={...source,schema_version:1,associations:[record("one","2026-10-01",[1],{record_id:"wrong"}),record("one","2026-10-02",[2],{record_id:"valid"})],review_leads:[{record_id:"mixed",date:"2026-10-03",talkgroup:6001,clips:[1],candidate_officer_ids:["one","two"],evidence:"Ron is addressed; Joshua Draper is a civilian"}],context_review_exclusions:{records:{wrong:{reason:"Civilian namesake"},mixed:{officer_ids:["one"],reason:"Wrong full-name candidate"}}}};
 const result=selectAssociationReview(input,manifest);
 assert.deepEqual(result.people[0].days.map(d=>d.date),["2026-10-02"]);
 assert.deepEqual(result.people[1].days[0].evidence[0].candidate_officer_ids,["two"]);
 assert.ok(!Object.values(result.clipCatalog).some(c=>c.date==="2026-10-01"));
 const {compileOfficerAssociations}=await import('../lib/build-officer-associations.js');
 const output=compileOfficerAssociations(input);
 assert.equal(output.labels.days["2026-10-01"],undefined);
 assert.equal(output.labels.days["2026-10-02"],undefined);
 assert.match(output.evidenceCsv,/valid/);
 assert.ok(!output.evidenceCsv.includes('"wrong"'));
 assert.ok(!output.summaryCsv.includes("2026-10-01"));
 assert.equal(input.associations.length,2);
});

test("real cleanup removes Brandon West while preserving actual officer mentions as unassigned leads",()=>{
 const html=fs.readFileSync(buildAssociationReview().output,"utf8");
 const payload=JSON.parse(html.match(/<script type="application\/json" id="review-data">([\s\S]*?)<\/script>/)[1]);
 const visible=html.split('<script type="application/json"')[0];
 for(const id of ["N234","N005","V001","V020","N163"]) {
  assert.ok(!payload.source.review_leads.some(r=>r.record_id===`ai-report-${id}`));
  assert.ok(!visible.includes(`data-record-id="ai-report-${id}"`));
 }
 assert.ok(payload.source.review_leads.some(r=>r.record_id==="ai-report-N115"));
 assert.ok(payload.source.review_leads.some(r=>r.original_record_id==="legacy-review-023" && !r.radio_id));
 assert.ok(!payload.source.associations.some(r=>r.record_id==="legacy-review-023"));
 assert.match(visible,/id="person-select"/);assert.match(visible,/id="export-review"/);
});


test("person controls remain inert until selected, while all evidence stays in the export payload",()=>{
 const input={...source,associations:[record("one","2026-10-01",[1]),record("two","2026-10-02",[2])]};
 const html=renderAssociationReview(selectAssociationReview(input,manifest),input,"","");
 const templates=[...html.matchAll(/<template data-person="([^"]+)">([\s\S]*?)<\/template>/g)];
 assert.deepEqual(templates.map(t=>t[1]),["person-one","person-two"]);
 for(const template of templates) assert.match(template[2],/<audio preload="none"/);
 const shell=html.replace(/<template[\s\S]*?<\/template>/g,"").split('<script type="application/json"')[0];
 assert.ok(!shell.includes("<audio"));
 assert.ok(!shell.includes('class="person"'));
 const payload=JSON.parse(html.match(/<script type="application\/json" id="review-data">([\s\S]*?)<\/script>/)[1]);
 assert.equal(payload.source.associations.length,2);
 assert.equal(Object.keys(payload.clips).length,2);
});

 test("each clip has one evidence checkbox, context stays playable, and redundant controls are absent",()=>{
 const input={...source,associations:[record("one","2026-10-01",[1])]};
 const html=renderAssociationReview(selectAssociationReview(input,manifest),input,"","");
 assert.match(html,/data-clip-evidence/);
 for(const old of ["data-clip-remove","data-clip-confirm","data-show-removed",'class="evidence"',"data-confirm-person"])assert.ok(!html.includes(old));
 const data=JSON.parse(html.match(/<script type="application\/json" id="review-data">([\s\S]*?)<\/script>/)[1]);
 assert.ok(data.clip_selections.length>0);
 assert.ok(data.clip_selections.every(c=>c.officer_id && data.clips[c.clip_id]));
 });

 test("evidence defaults use cues while context and extra AI references remain in the list",()=>{
 const input={...source,associations:[record("one","2026-10-01",[1,2],{record_id:"cue",cue_clips:[2]})],ai_reviews:[{source_record_ids:["cue"],clip_references:[{date:"2026-10-01",talkgroup:6001,number:3}]}]};
 const manifests=(date,tg)=>({...manifest(date,tg),calls:[...manifest(date,tg).calls,{epoch:300,original_filename:`dcfems-${tg}-300.m4a`,transcript:"Context"}]});
 const html=renderAssociationReview(selectAssociationReview(input,manifests),input,"","");
 const payload=JSON.parse(html.match(/<script type="application\/json" id="review-data">([\s\S]*?)<\/script>/)[1]);
 assert.deepEqual(payload.clip_selections.map(c=>[c.number,c.evidence]),[[1,false],[2,true],[3,false]]);
 assert.equal((html.match(/data-clip-evidence/g)||[]).length,3);
 assert.equal((html.match(/<audio /g)||[]).length,1);
 assert.equal((html.match(/data-clip-evidence[^>]* checked/g)||[]).length,1);
 });

test("Mason dialogue review separates supported radios, backward acknowledgements and unanswered context",()=>{
 const html=fs.readFileSync(buildAssociationReview().output,"utf8");
 const payload=JSON.parse(html.match(/<script type="application\/json" id="review-data">([\s\S]*?)<\/script>/)[1]);
 const find=(date,number)=>payload.clip_selections.find(c=>c.officer_id==="brandon-k-mason"&&c.date===date&&c.number===number);
 for(const number of [219,220])assert.deepEqual(find("2026-10-10",number).evidence_radio_ids,["14590237"]);
 for(const number of [236,237,244,245])assert.deepEqual(find("2026-10-10",number).evidence_radio_ids,["14590315"]);
 const hail=find("2026-10-10",236);
 assert.deepEqual(hail.transmitter_radio_ids,["14590088"]);assert.equal(hail.dialogue_exchanges[0].role,"name_cue");
 assert.equal(find("2026-10-28",154).dialogue_exchanges[0].role,"preceding_speaker");
 for(const [date,number] of [["2026-09-12",634],["2026-09-12",635],["2026-09-17",432],["2026-10-23",23],["2026-10-29",122]]) {
  const clip=find(date,number);assert.equal(clip.evidence,false);assert.deepEqual(clip.evidence_radio_ids,[]);assert.ok(clip.context_reason);
 }
 for(const exchange of payload.source.dialogue_reviews.people["brandon-k-mason"].exchanges) {
  const rows=exchange.evidence_clips.map(n=>find(exchange.date,n));
  assert.ok(rows.every(Boolean),exchange.exchange_id);
  assert.ok(rows.some(c=>c.transmitter_radio_ids.includes(exchange.target_radio_id)),exchange.exchange_id);
 }
});


test("owner-selected context persists by stable clip ID without asserting transmitter identity",()=>{
 const choice={officer_id:"one",clip_id:"6001:2026-10-01:dcfems-6001-100.m4a",number:1,included:true,reviewer:"Eric",reviewed_at:"2026-11-01"};
 const day={date:"2026-10-01",talkgroup:6001,evidence:[{clips:[1,2],owner_clip_selections:[choice]}]};
 const selected=clipDialogueEvidence(source,"one",day,{id:choice.clip_id,number:1});
 assert.equal(selected.evidence,true);
 assert.equal(selected.owner_evidence_review.reviewer,"Eric");
 assert.deepEqual(selected.evidence_radio_ids,[]);
 assert.equal(clipDialogueEvidence(source,"two",day,{id:choice.clip_id,number:1}).evidence,false);
 assert.equal(clipDialogueEvidence(source,"one",day,{id:"6001:2026-10-01:dcfems-6001-200.m4a",number:1}).evidence,false);
 assert.equal(clipDialogueEvidence(source,"one",day,{id:choice.clip_id,number:9}).evidence,true);
});
