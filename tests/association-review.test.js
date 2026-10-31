import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {selectAssociationReview, renderAssociationReview, buildAssociationReview} from "../lib/build-association-review.js";
const source = {officers:{one:{name:"First Officer"},two:{name:"Second Officer"}}, associations:[]};
const record = (officer_id,date,clips,extra={})=>({officer_id,date,clips,talkgroup:6001,status:"supporting",radio_id:"123",evidence:"Original uncertainty",...extra});
const manifest = date=>({date,talkgroup:6001,calls:[{epoch:200,original_filename:"dcfems-6001-200.m4a",transcript:"Second"},{epoch:100,original_filename:"dcfems-6001-100.m4a",transcript:"First"}]});

test("review groups every candidate separately, orders dates and clips, deduplicates within a day, and excludes days without 6001 clips",()=>{
 const input={...source,associations:[record("one","2026-10-02",[2,1]),record("one","2026-10-02",[1]),record("two","2026-10-02",[1]),record("one","2026-10-01",[1]),record("one","2026-10-03",[]),record("two","2026-10-04",[1],{talkgroup:5922}),record("two","2026-10-05",[1],{status:"rejected"})]};
 const result=selectAssociationReview(input,manifest);
 assert.equal(result.people.length,2);assert.equal(result.personDays,3);assert.equal(result.selections,4);
 assert.deepEqual(result.people[0].days.map(d=>d.date),["2026-10-01","2026-10-02"]);
 assert.deepEqual(result.people[0].days[1].calls.map(c=>[c.number,c.transcript]),[[1,"First"],[2,"Second"]]);
 assert.equal(result.people[1].days[0].calls[0].number,1);
 assert.throws(()=>selectAssociationReview({...source,associations:[record("one","2026-10-01",[3])]},manifest),/Missing 6001 clip/);
 assert.throws(()=>selectAssociationReview({...source,associations:[record("one","2026-10-01",[1])]},manifest,()=>false),/Audio unavailable/);
});

test("HTML safely renders uncertainty, gives each day controls, and preloads no audio",()=>{
 const input={...source,associations:[record("one","2026-10-01",[1],{evidence:'<script>unsafe</script>',name_heard:'"First?"',candidate_officer_ids:["one","two"]})]};
 const html=renderAssociationReview(selectAssociationReview(input,manifest),input,"body{}","test()");
 assert.match(html,/&lt;script&gt;unsafe&lt;\/script&gt;/);assert.match(html,/First Officer \/ Second Officer/);
 assert.match(html,/<audio controls preload="none"/);assert.match(html,/data-action="previous"/);assert.match(html,/data-autoplay/);
 assert.match(html,/noindex, nofollow/);assert.match(html,/data-transcript="First"/);
});

test("real review includes exactly the referenced 6001 selections for all candidates",()=>{
 const input=JSON.parse(fs.readFileSync("data/officer-association-evidence.json","utf8"));
 const expected=new Map();
 for(const r of input.associations){if(r.talkgroup!==6001||r.status==="rejected"||!r.clips.length)continue;const key=`${r.officer_id}/${r.date}`;if(!expected.has(key))expected.set(key,new Set());r.clips.forEach(n=>expected.get(key).add(n));}
 const result=buildAssociationReview();
 assert.equal(result.days,expected.size);assert.equal(result.clips,[...expected.values()].reduce((n,s)=>n+s.size,0));
 assert.equal(result.people,new Set([...expected.keys()].map(k=>k.split("/")[0])).size);
 const html=fs.readFileSync(result.output,"utf8");
 assert.equal((html.match(/data-day>/g)||[]).length,result.days);
 assert.equal((html.match(/class="clip"/g)||[]).length,result.clips);
 assert.ok(!html.includes("dcfems-5922-"));assert.ok(html.includes("Anthony S. Neil"));
 assert.match(html,/https:\/\/media\.afpd-accountability\.com\/openmhz\//);
 const ids=[...html.matchAll(/\sid="([^"]+)"/g)].map(m=>m[1]);assert.equal(ids.length,new Set(ids).size);
});
