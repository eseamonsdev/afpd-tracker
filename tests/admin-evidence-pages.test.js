import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import nunjucks from 'nunjucks';
const env=new nunjucks.Environment(new nunjucks.FileSystemLoader(['src','src/_includes']),{autoescape:true});
const adminTools=JSON.parse(fs.readFileSync('src/_data/adminTools.json','utf8'));
test('dashboard and navigation link to the protected evidence workspace',()=>{
  const html=env.render('admin-index.njk',{adminTools});
  assert.match(html,/href="\/admin\/association-evidence\/"/);
  assert.match(html,/Association Evidence/);
});
test('full-day evidence controls are admin-only and evidence groups link back to their full day',()=>{
  const html=env.render('admin-police-radio.njk',{adminTools});
  for(const id of ['admin-evidence-dialog','admin-evidence-officer','admin-evidence-radio','admin-evidence-numbers','admin-evidence-add'])
    assert.equal(html.split(`id="${id}"`).length-1,1);
  assert.ok(html.indexOf('/js/admin-radio-evidence.js')<html.indexOf('/js/admin-police-radio.js'));
  for(const page of ['police-radio','police-radio-excerpt'])
    assert.doesNotMatch(fs.readFileSync(`src/${page}.njk`,'utf8'),/admin-radio-evidence/);
  const evidence=env.render('admin-evidence-excerpt.njk',{adminTools});
  assert.match(evidence,/id="evidence-full-day"[^>]*>Open full day in admin/);
});
test('evidence workspace has separate reviewed state, notes, speaker confirmation and transcript editing',()=>{
  const html=env.render('admin-evidence-excerpt.njk',{adminTools});
  for(const id of ['evidence-reviewed','evidence-notes','evidence-save','evidence-delete','evidence-clips','evidence-transcript-input','evidence-verified','evidence-speaker-confirmed','evidence-talkgroup'])
    assert.equal(html.split(`id="${id}"`).length-1,1);
  assert.ok(html.indexOf('/js/radio-player-core.js')<html.indexOf('/js/admin-evidence-excerpt.js'));
  assert.doesNotMatch(html,/radio-date-picker|make associations-from-db/);
  assert.ok(html.indexOf('id="evidence-verified"')<html.indexOf('id="evidence-speaker-confirmed"'));
  assert.ok(html.indexOf('id="evidence-speaker-confirmed"')<html.indexOf('id="evidence-clips"'));
  const regularAdmin=env.render('admin-police-radio.njk',{adminTools});
  assert.doesNotMatch(regularAdmin,/speaker-confirmed/);
  const list=env.render('admin-association-evidence.njk',{adminTools});
  assert.equal(list.split('id="evidence-officer"').length-1,1);
  assert.match(list,/<option value="">All officers<\/option>/);
  for(const status of ['all','reviewed','unreviewed'])assert.ok(list.includes(`value="${status}"`));
});
