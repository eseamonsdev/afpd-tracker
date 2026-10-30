#!/usr/bin/env node
// Sequential metadata-only audit; failed jobs are never interpreted as zero matches.
const fs=require('node:fs/promises');
const path=require('node:path');
const {spawn}=require('node:child_process');
const args=Object.fromEntries(process.argv.slice(2).map(x=>{const [k,...v]=x.replace(/^--/,'').split('=');return[k,v.join('=')]}));
function sourceIds(call){return [...new Set([...(call.srcList||[]).map(s=>s.src),...(call.radio_ids||[])].map(String).filter(x=>/^\d+$/.test(x)&&+x>0))]}
function compare(calls,known){const matches=calls.map(c=>({id:c._id||c.id,time:c.time||c.timestamp_utc,radio_ids:sourceIds(c).filter(id=>known.has(id))})).filter(c=>c.radio_ids.length);return{matching_calls:matches.length,distinct_matching_ids:[...new Set(matches.flatMap(c=>c.radio_ids))].sort(),matches}}
module.exports={sourceIds,compare};
if(require.main===module)(async()=>{
 const groups=(args.talkgroups||'6002,6003,6223,6224,6225,6226,6227,5964,5965,5921,5924').split(',');
 const dates=(args.dates||'2026-10-22,2026-10-29').split(',');
 const {validateDate}=require('./collect-openmhz.cjs');dates.forEach(validateDate);
 if(groups.some(g=>!/^\d+$/.test(g)||+g<1||+g>65535))throw Error('Invalid talkgroup');
 if(!args['known-ids'])throw Error('Supply --known-ids=PATH to a reference list');
 const ref=JSON.parse(await fs.readFile(args['known-ids'],'utf8'));const ids=Array.isArray(ref)?ref:ref.radio_ids;if(!Array.isArray(ids))throw Error('Reference list needs radio_ids');
 const known=new Set(ids.map(String).filter(x=>/^\d+$/.test(x)&&+x>0));
 const out=path.resolve(args.output||'openmhz-audit-results');await fs.mkdir(out,{recursive:true});
 const results=[];
 for(const tg of [...new Set(groups)])for(const date of [...new Set(dates)]){
  const base=path.join(out,tg);const dest=path.join(base,date);await fs.mkdir(dest,{recursive:true});
  // Do not re-use an old summary as evidence if this attempt exits before writing one.
  await fs.rm(path.join(dest,'summary.json'),{force:true});
  const cli=[path.join(__dirname,'collect-openmhz.cjs'),`--talkgroup=${tg}`,`--date=${date}`,`--output=${base}`];
  for(const k of ['buffer-ms','progress-seconds','executable-path','proxy'])if(args[k])cli.push(`--${k}=${args[k]}`);
  if(Object.hasOwn(args,'headed'))cli.push('--headed');
  const exitCode=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,cli,{stdio:'inherit'});child.on('error',reject);child.on('close',resolve)});
  let summary,calls=[];try{summary=JSON.parse(await fs.readFile(path.join(dest,'summary.json'),'utf8'));calls=JSON.parse(await fs.readFile(path.join(dest,'calls.json'),'utf8')).calls}catch(e){summary={status:'incomplete',error:e.message}}
  const complete=exitCode===0&&summary.status==='complete'&&summary.olderBoundaryReached&&summary.newerBoundaryReached;
  const row={talkgroup:+tg,date,complete,exitCode,summary,...compare(calls,known)};results.push(row);
  await fs.writeFile(path.join(out,'audit.json'),JSON.stringify({reference:args['known-ids'],reference_id_count:known.size,note:'Exact source-ID overlap does not establish AFPD ownership. Counts from incomplete jobs are partial, not full-day negatives.',results},null,2)+'\n');
  console.log(`AUDIT TG ${tg} ${date}: ${complete?'COMPLETE':'INCOMPLETE'}; ${calls.length} collected calls; ${row.matching_calls} matching calls; ${row.distinct_matching_ids.length} distinct matching IDs`);
  if(/navigation HTTP|HTTP (403|429)|verify|access.denied|browserType.launch/i.test(summary.error||''))throw Error('Environment/access failure; remaining jobs stopped. Partial results saved.');
 }
 if(results.some(x=>!x.complete))process.exitCode=1;
})().catch(e=>{console.error('AUDIT ERROR: '+e.message);process.exitCode=1});
