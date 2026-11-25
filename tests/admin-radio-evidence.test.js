import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { radioEvidence } from '../src/admin-radio-evidence.js';

function database(){
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE officers (id INTEGER PRIMARY KEY,url_slug TEXT,display_name_id INTEGER);
    CREATE TABLE officer_names (id INTEGER PRIMARY KEY,officer_id INTEGER,name_text TEXT);
    CREATE TABLE radio_ids (radio_id TEXT PRIMARY KEY);
    CREATE TABLE radio_clips (id TEXT PRIMARY KEY,system TEXT,archive_date TEXT,talkgroup_number INTEGER,clip_number INTEGER,transcript TEXT,transcript_validated INTEGER);
    CREATE TABLE radio_clip_radio_ids (clip_id TEXT,radio_id TEXT);
    INSERT INTO officers VALUES (1,'officer-one',1),(2,'officer-two',2);
    INSERT INTO officer_names VALUES (1,1,'Officer One'),(2,2,'Officer Two');
    INSERT INTO radio_ids VALUES ('14590027'),('14590028'),('14590114');
    INSERT INTO radio_clips VALUES
      ('clip1','dcfems','2026-11-01',6001,1,'Hey One.',1),
      ('clip2','dcfems','2026-11-01',6001,2,'Yes?',0),
      ('clip3','dcfems','2026-11-01',6001,3,'Context.',1),
      ('clip4','dcfems','2026-11-02',6001,1,'Next day.',0),
      ('law1','dcfems','2026-11-01',5922,1,'Law 2.',0);
    INSERT INTO radio_clip_radio_ids VALUES ('clip1','14590027'),('clip2','14590028'),('law1','14590114');
  `);
  sqlite.exec(fs.readFileSync(new URL('../db/migrations/0007_association_evidence.sql',import.meta.url),'utf8'));
  sqlite.exec(`INSERT INTO radio_associations VALUES ('a1','officer-one','Officer One','14590027','Strong association',1,'{}');
    INSERT INTO radio_association_evidence (id,association_id,archive_date,talkgroup_number,website_visible,source_json,reviewed,correction_notes,revision)
      VALUES ('legacy-group','a1','2026-11-01',6001,1,'[{"evidence":"Original source"}]',1,'Keep these notes',4);
    INSERT INTO radio_association_evidence_clips VALUES ('legacy-group','clip1',1,1);`);
  const db={sqlite,beforeBatch:null,prepare(sql){return {bind(...params){return {
    async all(){return {results:sqlite.prepare(sql).all(...params)};},
    async first(){return sqlite.prepare(sql).get(...params)||null;},
    run(){const r=sqlite.prepare(sql).run(...params);return {meta:{changes:Number(r.changes)}};}
  };}};},async batch(statements){
    if(db.beforeBatch){const f=db.beforeBatch;db.beforeBatch=null;f();}
    sqlite.exec('BEGIN');try{const results=statements.map(s=>s.run());sqlite.exec('COMMIT');return results;}
    catch(error){sqlite.exec('ROLLBACK');throw error;}
  }};
  return db;
}
const origin='https://example.org';
const body=(extra={})=>({action:'append',officer_key:'officer-one',radio_id:'14590027',date:'2026-11-01',talkgroup:6001,clip_ids:['clip1','clip2'],...extra});
const add=(db,data=body(),requestOrigin=origin)=>{const url=new URL('/admin/api/radio-evidence',origin);return radioEvidence(new Request(url,{method:'POST',headers:{Origin:requestOrigin,'Content-Type':'application/json'},body:JSON.stringify(data)}),url,db,'Eric');};
const group=db=>db.sqlite.prepare("SELECT * FROM radio_association_evidence WHERE id='legacy-group'").get();
const clips=db=>db.sqlite.prepare("SELECT * FROM radio_association_evidence_clips WHERE evidence_id='legacy-group' ORDER BY position").all();

test('append retains existing confirmations and notes, adds missing clips unchecked, and reopens review',async()=>{
  const db=database();const response=await add(db,body({correction_notes:'Do not apply',reviewed:true,speaker_confirmed:true}));
  assert.equal(response.status,200);const result=await response.json();
  assert.equal(result.evidence_id,'legacy-group');assert.equal(result.added,1);assert.equal(result.total,2);assert.equal(result.created,false);
  assert.equal(group(db).correction_notes,'Keep these notes');assert.equal(group(db).reviewed,0);assert.equal(group(db).revision,5);
  assert.deepEqual(clips(db).map(c=>[c.clip_id,c.speaker_confirmed]),[['clip1',1],['clip2',0]]);
  assert.equal(JSON.parse(group(db).source_json)[0].evidence,'Original source');
  assert.deepEqual({...db.sqlite.prepare("SELECT transcript,transcript_validated FROM radio_clips WHERE id='clip2'").get()},{transcript:'Yes?',transcript_validated:0});
});
test('duplicate-only additions leave reviewed status, revisions, notes and confirmations unchanged',async()=>{
  const db=database(),before={...group(db)};
  const result=await (await add(db,body({clip_ids:['clip1']}))).json();
  assert.equal(result.added,0);assert.equal(result.reviewed,true);assert.deepEqual({...group(db)},before);
  await add(db);db.sqlite.exec("UPDATE radio_association_evidence SET reviewed=1,revision=revision+1 WHERE id='legacy-group'; UPDATE radio_association_evidence_clips SET speaker_confirmed=1 WHERE evidence_id='legacy-group' AND clip_id='clip2';");
  const reviewed={...group(db)};assert.equal((await (await add(db)).json()).added,0);
  assert.deepEqual({...group(db)},reviewed);assert.equal(clips(db)[1].speaker_confirmed,1);
});
test('empty existing groups are filled, while new officer/radio/date/talkgroup combinations remain separate',async()=>{
  const db=database();db.sqlite.exec("DELETE FROM radio_association_evidence_clips WHERE evidence_id='legacy-group'");
  assert.equal((await (await add(db)).json()).evidence_id,'legacy-group');
  const other=await (await add(db,body({officer_key:'officer-two',radio_id:'14590114',clip_ids:['clip2']}))).json();
  assert.equal(other.created,true);assert.notEqual(other.evidence_id,'legacy-group');
  const repeat=await (await add(db,body({officer_key:'officer-two',radio_id:'14590114',clip_ids:['clip2']}))).json();
  assert.equal(repeat.evidence_id,other.evidence_id);assert.equal(repeat.added,0);
  const nextDay=await (await add(db,body({date:'2026-11-02',clip_ids:['clip4']}))).json();assert.equal(nextDay.created,true);
  const law=await (await add(db,body({talkgroup:5922,clip_ids:['law1']}))).json();assert.equal(law.created,true);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM radio_association_evidence').get().n,4);
});
test('day membership includes context links to every associated group and a full officer directory',async()=>{
  const db=database();await add(db,body({officer_key:'officer-two',radio_id:'14590114',clip_ids:['clip1']}));
  const url=new URL('/admin/api/radio-evidence?date=2026-11-01&talkgroup=6001',origin);
  const response=await radioEvidence(new Request(url),url,db,'Eric');assert.equal(response.headers.get('Cache-Control'),'no-store');
  const data=await response.json();assert.equal(data.memberships.filter(m=>m.clip_id==='clip1').length,2);
  assert.deepEqual(data.officers.map(o=>o.officer_key),['officer-one','officer-two']);
  assert.deepEqual(data.radio_ids,['14590027','14590028']);
});
test('invalid actions, origins, officers, radio IDs and cross-day clips cannot change evidence',async()=>{
  const db=database();assert.equal((await add(db,body(),'https://evil.example')).status,403);
  for(const patch of [{action:'replace'},{officer_key:'unknown'},{radio_id:'999'},{radio_id:'x'},{date:'2026-02-30'},{talkgroup:6036},{clip_ids:['law1']},{clip_ids:['clip4']},{clip_ids:[]}]){
    assert.equal((await add(db,body(patch))).status,400,JSON.stringify(patch));
  }
  assert.equal(group(db).revision,4);assert.equal(clips(db).length,1);
});
test('concurrent appends combine selections without losing notes or confirmations',async()=>{
  const db=database();
  const responses=await Promise.all([add(db,body({clip_ids:['clip2']})),add(db,body({clip_ids:['clip3']}))]);
  assert.ok(responses.every(r=>r.status===200));
  assert.deepEqual(clips(db).map(c=>c.clip_id),['clip1','clip2','clip3']);
  assert.equal(group(db).correction_notes,'Keep these notes');assert.equal(group(db).revision,6);assert.equal(clips(db)[0].speaker_confirmed,1);
});
test('a concurrent editor change is preserved by retrying the addition against its new revision',async()=>{
  const db=database();db.beforeBatch=()=>db.sqlite.exec("UPDATE radio_association_evidence SET correction_notes='Edited in another tab',revision=5 WHERE id='legacy-group'");
  assert.equal((await add(db)).status,200);assert.equal(group(db).correction_notes,'Edited in another tab');assert.equal(group(db).revision,6);
  assert.equal(clips(db)[0].speaker_confirmed,1);
});
