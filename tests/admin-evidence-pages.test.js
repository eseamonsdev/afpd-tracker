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
test('evidence workspace has separate reviewed state, notes, speaker confirmation and transcript editing',()=>{
  const html=env.render('admin-evidence-excerpt.njk',{adminTools});
  for(const id of ['evidence-reviewed','evidence-notes','evidence-save','evidence-clips','evidence-transcript-input','evidence-verified'])
    assert.equal(html.split(`id="${id}"`).length-1,1);
  assert.ok(html.indexOf('/js/radio-player-core.js')<html.indexOf('/js/admin-evidence-excerpt.js'));
  assert.doesNotMatch(html,/radio-date-picker|make associations-from-db/);
  const list=env.render('admin-association-evidence.njk',{adminTools});
  for(const status of ['all','reviewed','unreviewed'])assert.ok(list.includes(`value="${status}"`));
});
