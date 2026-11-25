import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { associationEvidence } from '../src/admin-association-evidence.js';
import { prepareAssociationEvidence } from '../db/prepare_association_evidence.mjs';

function database(){
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE radio_clips (id TEXT PRIMARY KEY,system TEXT,talkgroup_number INTEGER,archive_date TEXT,clip_number INTEGER,
      timestamp_utc TEXT,original_filename TEXT,archive_path TEXT,displayed_seconds INTEGER,audio_duration_seconds REAL,
      audio_key TEXT,transcript TEXT,transcript_validated INTEGER);
    CREATE TABLE radio_clip_radio_ids (clip_id TEXT,radio_id TEXT);
  `);
  sqlite.exec(fs.readFileSync(new URL('../db/migrations/0007_association_evidence.sql',import.meta.url),'utf8'));
  sqlite.exec(`INSERT INTO radio_associations VALUES ('a1','anthony-s-neil','Anthony S. Neil','14590027','Strong association',1,'{}');
    INSERT INTO radio_association_evidence (id,association_id,archive_date,talkgroup_number,website_visible,source_json) VALUES
      ('group1','a1','2026-11-01',6001,1,'[]'),('group2','a1','2026-11-02',6001,0,'[]');`);
  for(let i=1;i<=3;i++)sqlite.prepare(`INSERT INTO radio_clips VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    'clip'+i,'dcfems',6001,'2026-11-01',i,'2026-11-01T12:00:00Z',`dcfems-6001-${100+i}.m4a`,
    'public/records/openmhz/openmhz-afpd-car-to-car-2026-11-01/calls.json',3,3,'audio/'+i,i===1?'Hey Neil.':'Yes?',i===1?1:0);
  sqlite.exec(`INSERT INTO radio_association_evidence_clips VALUES ('group1','clip1',1,0),('group1','clip2',2,0),('group2','clip1',1,0);`);
  const db={sqlite,prepare(sql){return {bind(...params){return {
    async all(){return {results:sqlite.prepare(sql).all(...params)};},
    async first(){return sqlite.prepare(sql).get(...params)||null;},
    run(){const r=sqlite.prepare(sql).run(...params);return {meta:{changes:Number(r.changes)}};}
  };}};},async batch(statements){
    sqlite.exec('BEGIN');try{const results=statements.map(s=>s.run());sqlite.exec('COMMIT');return results;}
    catch(error){sqlite.exec('ROLLBACK');throw error;}
  }};return db;
}
const origin='https://example.org';
const read=(db,query='evidence=group1')=>{const url=new URL('/admin/api/association-evidence?'+query,origin);return associationEvidence(new Request(url),url,db,'Eric');};
const change=()=>({id:'group1',revision:0,reviewed:true,correction_notes:'Clip 1 addresses Neil; clip 2 is his response.',
  clips:[{id:'clip2',speaker_confirmed:true}],transcripts:[{id:'clip2',transcript:'Yes, I can.',validated:true,expected_transcript:'Yes?',expected_validated:false}]});
const save=(db,body,requestOrigin=origin)=>{const url=new URL('/admin/api/association-evidence',origin);return associationEvidence(new Request(url,{method:'POST',headers:{Origin:requestOrigin,'Content-Type':'application/json'},body:JSON.stringify(body)}),url,db,'Eric');};

test('evidence uses per-group speaker flags independently of transcript verification',async()=>{
  const db=database();const {group}=await (await read(db)).json();
  assert.equal(group.clips[0].validated,true);assert.equal(group.clips[0].speaker_confirmed,false);
  assert.equal(group.reviewed,false);assert.equal(group.clips[0].source,'/records/openmhz/openmhz-afpd-car-to-car-2026-11-01/dcfems-6001-101.m4a');
});
test('saving notes, reviewed state, speaker confirmation and transcript is persistent and isolated',async()=>{
  const db=database();assert.equal((await save(db,change())).status,200);
  const {group}=await (await read(db)).json();assert.equal(group.reviewed,true);assert.equal(group.revision,1);
  assert.equal(group.correction_notes,change().correction_notes);assert.equal(group.clips.length,1);
  assert.equal(group.clips[0].speaker_confirmed,true);assert.equal(group.clips[0].transcript,'Yes, I can.');
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM radio_clips').get().n,3);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM radio_association_evidence_clips WHERE evidence_id='group2'").get().n,1);
  const list=await (await read(db,'status=reviewed')).json();assert.equal(list.groups.length,1);assert.deepEqual(list.counts,{total:1,reviewed:1,unreviewed:0});
  assert.equal((await (await read(db,'status=unreviewed')).json()).groups.length,0);
});
test('stale transcript aborts every write, including notes and membership',async()=>{
  const db=database();db.sqlite.exec("UPDATE radio_clips SET transcript='Someone else edited' WHERE id='clip2'");
  assert.equal((await save(db,change())).status,409);
  const {group}=await (await read(db)).json();assert.equal(group.revision,0);assert.equal(group.reviewed,false);
  assert.equal(group.correction_notes,'');assert.equal(group.clips.length,2);
  assert.equal(group.clips[1].transcript,'Someone else edited');
});
test('rejects stale group revisions, cross-origin writes and unrelated recordings',async()=>{
  const db=database();assert.equal((await save(db,change(),'https://evil.example')).status,403);
  assert.equal((await save(db,{...change(),revision:9})).status,409);
  assert.equal((await save(db,{...change(),transcripts:[{...change().transcripts[0],id:'outside'}]})).status,400);
  db.sqlite.exec("UPDATE radio_clips SET archive_date='2026-11-02' WHERE id='clip3'");
  assert.equal((await save(db,{...change(),clips:[{id:'clip3',speaker_confirmed:true}]})).status,400);
});
test('empty groups can be saved and clips added by archive numbers without public date indexes',async()=>{
  const db=database();const body={...change(),clips:[],transcripts:[]};
  assert.equal((await save(db,body)).status,200);
  const lookup=await (await read(db,'evidence=group1&clips=1,3,99')).json();
  assert.equal(lookup.clips.length,2);assert.deepEqual(lookup.missing,[99]);
  assert.equal((await save(db,{...body,revision:1,clips:[{id:'clip3',speaker_confirmed:true}]})).status,200);
});
test('officer filter matches exact identities, combines review filters and scopes progress to that officer',async()=>{
  const db=database();
  db.sqlite.exec(`INSERT INTO radio_associations VALUES ('a2','anthony-s-neilson','Another Officer','14590028','Candidate',1,'{}');
    INSERT INTO radio_association_evidence (id,association_id,archive_date,talkgroup_number,website_visible,source_json)
    VALUES ('group3','a2','2026-11-01',6001,1,'[]');`);
  assert.equal((await save(db,change())).status,200);
  const data=await (await read(db,'officer=anthony-s-neil&status=all&scope=all')).json();
  assert.equal(data.groups.length,2);
  assert.ok(data.groups.every(group=>group.officer_key==='anthony-s-neil'));
  assert.deepEqual(data.counts,{total:2,reviewed:1,unreviewed:1});
  assert.deepEqual(data.officers.map(officer=>officer.officer_key),['anthony-s-neilson','anthony-s-neil']);
  const unreviewed=await (await read(db,'officer=anthony-s-neil&status=unreviewed&scope=all')).json();
  assert.equal(unreviewed.groups.length,1);assert.equal(unreviewed.groups[0].id,'group2');
  const website=await (await read(db,'officer=anthony-s-neil&status=all')).json();
  assert.equal(website.groups.length,1);assert.deepEqual(website.counts,{total:1,reviewed:1,unreviewed:0});
  const searched=await (await read(db,'officer=anthony-s-neil&status=all&q=14590028')).json();
  assert.equal(searched.groups.length,0);
  assert.equal((await read(db,'officer=bad%2Fid')).status,400);
});
test('additive import preserves saved notes, group review, clip removals and transcript edits on rerun',()=>{
  const db=database();const result=prepareAssociationEvidence();
  db.sqlite.exec(result.sql);
  const first=db.sqlite.prepare("SELECT id FROM radio_association_evidence WHERE id!='group1' AND id!='group2' LIMIT 1").get();
  db.sqlite.prepare('UPDATE radio_association_evidence SET correction_notes=?,reviewed=1,revision=1 WHERE id=?').run('Keep my review',first.id);
  db.sqlite.prepare('INSERT INTO radio_association_evidence_clips VALUES (?,?,1,1)').run(first.id,'clip3');
  db.sqlite.exec("UPDATE radio_clips SET transcript='My correction' WHERE id='clip1'");
  db.sqlite.exec(result.sql);
  const group=db.sqlite.prepare('SELECT * FROM radio_association_evidence WHERE id=?').get(first.id);
  assert.equal(group.reviewed,1);assert.equal(group.correction_notes,'Keep my review');
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM radio_association_evidence_clips WHERE evidence_id=?').get(first.id).n,1);
  assert.equal(db.sqlite.prepare("SELECT transcript FROM radio_clips WHERE id='clip1'").get().transcript,'My correction');
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM radio_associations').get().n,result.associations);
  assert.ok(result.websiteGroups>400);
});
