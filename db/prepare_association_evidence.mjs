// Produce an additive D1 migration/import, never an export or a public rebuild.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadAssociationEvidence } from '../lib/association-context-review.js';
import { compileOfficerAssociations } from '../lib/build-officer-associations.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hash = value => crypto.createHash('sha256').update(value).digest('hex').slice(0, 24);
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
export function prepareAssociationEvidence(directory = root) {
  const source = loadAssociationEvidence(directory);
  const { labels } = compileOfficerAssociations(source);
  const pairs = new Map(), groups = new Map();
  function group(officer, radio, date, talkgroup) {
    const pairKey = `${officer}/${radio}`;
    if (!pairs.has(pairKey)) pairs.set(pairKey, {
      id: `association-${hash(pairKey)}`, officer, radio, name: source.officers[officer]?.name || officer,
      status: 'Candidate', visible: false, metadata: source.officers[officer] || {}
    });
    const pair = pairs.get(pairKey), key = `${pairKey}/${date}/${talkgroup}`;
    if (!groups.has(key)) groups.set(key, { id: `evidence-${hash(key)}`, pair, date,
      talkgroup, clips: new Set(), visible: false, records: [] });
    return groups.get(key);
  }
  for (const row of source.associations) {
    const entry = group(row.officer_id, row.radio_id, row.date, row.talkgroup);
    entry.records.push(row);
    for (const clip of row.clips) entry.clips.add(clip);
  }
  for (const [officer, radios] of Object.entries(labels.profiles)) for (const radio of radios) {
    for (const evidence of radio.evidence) {
      const entry = group(officer, radio.radio_id, evidence.date, evidence.talkgroup);
      entry.visible = entry.pair.visible = true;
      entry.pair.status = radio.status_label;
      // Rendered evidence is the initial selection for website-visible groups.
      entry.websiteClips ??= new Set();
      for (const clip of evidence.clips) entry.websiteClips.add(clip);
      entry.records.push({ source: 'rendered-website-evidence', ...evidence });
    }
  }
  for (const [date, radios] of Object.entries(labels.shared_radio_use || {})) {
    for (const [radio, records] of Object.entries(radios)) for (const record of records) {
      const entry = group(record.officer_id, radio, date, record.talkgroup);
      entry.visible = entry.pair.visible = true;
      entry.websiteClips ??= new Set();
      for (const clip of record.clips) entry.websiteClips.add(clip);
      entry.records.push({ source: 'shared-use', ...record });
    }
  }
  // Clip overrides may not have a general association or evidence group.
  // Resolve their archive clip numbers inside D1 using the original filename.
  const overrides = [];
  for (const [filename, radios] of Object.entries(labels.clip_overrides || {})) {
    const [, tg, stamp] = /^dcfems-(\d+)-(\d+)\.m4a$/.exec(filename);
    const date = new Intl.DateTimeFormat('en-CA', {timeZone:'America/Denver',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(Number(stamp)*1000));
    for (const [radio, record] of Object.entries(radios)) {
      const entry = group(record.officer_id, radio, date, Number(tg));
      entry.visible = entry.pair.visible = true;
      entry.records.push({source:'clip-override', filename, ...record});
      overrides.push({entry, filename});
    }
  }
  const sql = [fs.readFileSync(path.join(directory,'db/migrations/0007_association_evidence.sql'),'utf8')];
  for (const pair of pairs.values()) sql.push(`INSERT OR IGNORE INTO radio_associations VALUES (${[
    pair.id,pair.officer,pair.name,pair.radio,pair.status,Number(pair.visible),JSON.stringify(pair.metadata)
  ].map(quote).join(',')});`);
  for (const entry of groups.values()) {
    sql.push(`INSERT OR IGNORE INTO radio_association_evidence (id,association_id,archive_date,talkgroup_number,website_visible,source_json)
      SELECT ${quote(entry.id)},a.id,${[entry.date,entry.talkgroup,Number(entry.visible),JSON.stringify(entry.records)].map(quote).join(',')}
      FROM radio_associations a WHERE a.officer_key=${quote(entry.pair.officer)} AND a.radio_id=${quote(entry.pair.radio)};`);
    const clips = [...(entry.websiteClips ?? entry.clips)];
    if (clips.length) sql.push(`INSERT OR IGNORE INTO radio_association_evidence_clips (evidence_id,clip_id,position)
      SELECT ${quote(entry.id)},c.id,c.clip_number FROM radio_clips c
      WHERE c.system='dcfems' AND c.archive_date=${quote(entry.date)} AND c.talkgroup_number=${entry.talkgroup}
      AND c.clip_number IN (${clips.join(',')}) AND EXISTS (SELECT 1 FROM radio_association_evidence WHERE id=${quote(entry.id)} AND revision=0);`);
  }
  for (const {entry,filename} of overrides) sql.push(`INSERT OR IGNORE INTO radio_association_evidence_clips (evidence_id,clip_id,position)
    SELECT ${quote(entry.id)},c.id,c.clip_number FROM radio_clips c WHERE c.original_filename=${quote(filename)}
    AND c.system='dcfems' AND c.archive_date=${quote(entry.date)} AND c.talkgroup_number=${entry.talkgroup}
    AND EXISTS (SELECT 1 FROM radio_association_evidence WHERE id=${quote(entry.id)} AND revision=0);`);
  // Preserve the original rules, rejected context, unresolved leads, and baseline
  // as individually addressable source records. These do not drive public labels.
  for (const file of ['officer-association-evidence.json','association-review-context-exclusions.json','production-officer-association-baseline.json']) {
    const data = JSON.parse(fs.readFileSync(path.join(directory,'data',file),'utf8'));
    for (const [key,value] of Object.entries(data)) {
      const records = Array.isArray(value) ? value.map((v,i)=>[String(i),v]) : value && typeof value==='object' ? Object.entries(value) : [['value',value]];
      for (const [recordId,record] of records) sql.push(`INSERT OR IGNORE INTO radio_association_assignments VALUES (${[
        `source-${hash(`${file}/${key}/${recordId}`)}`,`${file}/${key}`,JSON.stringify({key:recordId,value:record})
      ].map(quote).join(',')});`);
    }
  }
  return { sql:sql.join('\n')+'\n', associations:pairs.size, groups:groups.size,
    websiteGroups:[...groups.values()].filter(g=>g.visible).length };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const output = process.argv[2] || path.join(root,'db/local/association-evidence.sql');
  fs.mkdirSync(path.dirname(output),{recursive:true});
  const result = prepareAssociationEvidence(); fs.writeFileSync(output,result.sql);
  console.log(JSON.stringify({output,...result,sql:undefined}));
}
