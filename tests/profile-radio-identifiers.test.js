import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {withProfileRadioIdentifiers} from '../lib/profile-radio-identifiers.js';
import {compileOfficerAssociations} from '../lib/build-officer-associations.js';
import {readCsv} from '../lib/data/read-csv.js';

test('profiles receive a stable ID tab and shared radio view without changing manual identifiers',()=>{
 const page={id:'page',type:'officer-page',url:'/officers/one/',sections:[{id:'overview',title:'Overview'},{id:'employment',title:'Employment'}],observed_officer_ids:[{type:'call-sign',id:'5J42'},{type:'ucjis-user-id',id:'ACCOUNT'}]};
 const radio=[{radio_id:'123',evidence_days:2}];
 const result=withProfileRadioIdentifiers(page,{one:radio});
 assert.equal(result.radio_identifiers,radio);
 assert.deepEqual(result.sections.map(s=>s.id),['overview','observed-agency-ids','employment']);
 assert.deepEqual(result.observed_officer_ids,page.observed_officer_ids);
 assert.equal(page.sections.length,2);
 assert.equal(withProfileRadioIdentifiers(result,{one:radio}).sections.length,3);
 assert.equal(withProfileRadioIdentifiers(page,{}).sections.length,2);
 assert.equal(withProfileRadioIdentifiers({...page,type:'civilian-employee-page'},{one:radio}).radio_identifiers,undefined);
});

test('compiler profiles apply the same excluded evidence, dates and source notes as radio labels and CSVs',()=>{
 const row=(id,date,extra={})=>({record_id:id,date,officer_id:'one',radio_id:'123',talkgroup:6001,clips:[1,2],evidence:'Cue and reply',status:'supporting',...extra});
 const source={schema_version:1,review_mode:'include-all',officers:{one:{name:'One'}},associations:[row('a','2026-10-01'),row('b','2026-10-01',{clips:[2,3],talkgroup:5922}),row('excluded','2026-10-02'),row('old','2026-10-03')],context_review_exclusions:{records:{excluded:{reason:'Wrong person'}}},owner_evidence_reviews:{one:{active_record_ids:['a','b','excluded']}}};
 const result=compileOfficerAssociations(source),profile=result.labels.profiles.one[0];
 assert.equal(profile.evidence_days,1);assert.deepEqual(profile.evidence_dates,['2026-10-01']);
 assert.equal(profile.evidence.length,2);assert.equal(profile.evidence.find(d=>d.talkgroup===5922).url,'/law-2-radio/?date=2026-10-01');
 assert.ok(profile.evidence.every(d=>d.records.every(r=>!['excluded','old'].includes(r.record_id))));
 assert.equal(result.labels.days['2026-10-01']['123'][0].evidence_days,profile.evidence_days);
 assert.equal(result.labels.days['2026-10-02'],undefined);assert.equal(result.labels.days['2026-10-03'],undefined);
});

test('every built profile table matches shared summary rows and supports archive and clip review links',()=>{
 const shared=JSON.parse(fs.readFileSync('public/records/openmhz/officer-associations.json'));
 const csv=readCsv('openmhz/afpd-radio-officer-ids.csv');let checked=0;
 for(const file of fs.readdirSync('data/entities/pages/officer-pages')) {
  const page=JSON.parse(fs.readFileSync(`data/entities/pages/officer-pages/${file}`)).entities[0];
  const slug=/^\/officers\/([^/]+)\/$/.exec(page.url)?.[1],radios=shared.profiles[slug]??[];
  if(!radios.length)continue;
  const html=fs.readFileSync(`public${page.url}index.html`,'utf8');
  const table=html.match(/aria-label="Radio ID observations and supporting evidence"[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/);
  assert.ok(table,slug);checked++;
  const ids=[...table[1].matchAll(/<th scope="row"><code>([^<]+)<\/code>/g)].map(m=>m[1]);
  assert.deepEqual(ids,radios.map(r=>r.radio_id),slug);
  for(const radio of radios) {
   const row=csv.rows.find(r=>r[8]===slug&&r[2]===radio.radio_id);
   assert.equal(Number(row[3]),radio.evidence_days);assert.equal(row[5],radio.evidence_dates.join('; '));assert.equal(row[4],radio.status_label);
   assert.ok(radio.evidence.every(day=>day.records.length));
  }
 }
 assert.ok(checked>0);
 const mason=fs.readFileSync('public/officers/brandon-k-mason/index.html','utf8');
 assert.ok(mason.includes('Observed Officer IDs'));assert.ok(mason.includes('officer-association-review.html#brandon-k-mason-2026-10-28-6001'));
 assert.ok(!mason.includes('<time datetime="2026-10-23">'));
});

test('all twelve profile radio observations survive in canonical evidence and manual radio arrays are removed',()=>{
 const source=JSON.parse(fs.readFileSync('data/officer-association-evidence.json'));
 const migrated=source.associations.filter(r=>r.source==='migrated_profile_radio_evidence');
 assert.equal(migrated.length,12);
 for(const row of migrated) {
  const original=row.provenance.original_observation;
  assert.equal(row.evidence,original.evidence);assert.equal(row.source_url,original.url);assert.equal(row.radio_id,original.id);
 }
 const indirect=migrated.find(r=>r.officer_id==='diego-o-garcia'&&r.radio_id==='14590089');
 assert.equal(indirect.status,'supporting');assert.equal(indirect.confirmed_by,null);
 for(const file of fs.readdirSync('data/entities/people/officers')) {
  const officer=JSON.parse(fs.readFileSync(`data/entities/people/officers/${file}`)).entities[0];
  assert.ok(!(officer.observed_officer_ids??[]).some(row=>row.type==='radio-id'),file);
 }
});
