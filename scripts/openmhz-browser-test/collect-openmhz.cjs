#!/usr/bin/env node
/* Metadata-only collector: ordinary OpenMHz page pagination, no synthetic API calls. */
const { chromium } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const args = Object.fromEntries(process.argv.slice(2).map(x => {const [k,...v]=x.replace(/^--/,'').split('=');return [k,v.join('=') || true]}));
const zone = String(args.timezone || 'America/Denver');
function midnight(date) {
  let guess = Date.parse(date+'T00:00:00Z');
  const target=guess;
  const fmt=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
  for(let i=0;i<4;i++){const p=Object.fromEntries(fmt.formatToParts(new Date(guess)).map(x=>[x.type,x.value]));const represented=Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);guess+=target-represented;}
  return guess;
}
function nextDate(d) {return new Date(Date.parse(d+'T00:00:00Z')+86400000).toISOString().slice(0,10)}
function validateDate(d) { if(!/^\d{4}-\d{2}-\d{2}$/.test(d)||!Number.isFinite(Date.parse(d+'T00:00:00Z'))||new Date(d+'T00:00:00Z').toISOString().slice(0,10)!==d) throw Error('Invalid calendar date: '+d);return d }
async function collect(date) {
  validateDate(date);
  const start=midnight(date),end=midnight(nextDate(date));
  if(end>Date.now())throw Error('Only finished calendar days may be audited');
  const system=String(args.system||'dcfems'),tg=Number(args.talkgroup||6001),gap=Number(args['buffer-ms']||500);
  if(!Number.isFinite(start)||(!Number.isInteger(tg)||tg<1||tg>65535)||!Number.isFinite(gap)||gap<0)throw Error('Invalid arguments');
  const out=path.resolve(String(args.output||'openmhz-results'),date);await fs.mkdir(out,{recursive:true});
  const pageUrl=`https://openmhz.com/system/${encodeURIComponent(system)}?filter-type=talkgroup&filter-code=${tg}&time=${Math.floor((start+end)/2)}`;
  const calls=new Map(),batches=[],pending=new Set();let failure=null,browser,page,requests=0,queue=Promise.resolve(),closing=false;
  const begun=new Date().toISOString();
  const progressMs=Number(args['progress-seconds']||10)*1000;
  if(!Number.isFinite(progressMs)||progressMs<1000)throw Error('--progress-seconds must be at least 1');
  let phase='starting browser', lastDataAt=Date.now(), lastGrowthAt=Date.now(), progressTimer, progressTask=null;
  const clock=new Intl.DateTimeFormat('en-US',{timeZone:zone,month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false,timeZoneName:'short'});
  const fmt=t=>Number.isFinite(t)?clock.format(new Date(t)):'not yet available';
  const log=message=>console.log(`[${date} TG ${tg} +${Math.floor((Date.now()-Date.parse(begun))/1000)}s] ${message}`);
  async function progress(){
    let visible='waiting for rows';
    if(page&&!page.isClosed()){
      try {
        const ids=await page.locator('#calls tbody tr[data-callid]').evaluateAll(rows=>rows.filter(row=>{const r=row.getBoundingClientRect();return r.bottom>0&&r.top<window.innerHeight}).map(row=>row.dataset.callid),undefined,{timeout:1500});
        if(ids.length){const top=calls.get(ids[0]),bottom=calls.get(ids.at(-1));visible=`visible top ${fmt(Date.parse(top?.time))}; bottom ${fmt(Date.parse(bottom?.time))}`;}
      }catch{visible='visible rows unavailable';}
    }
    const b=bounds(),idle=Math.floor((Date.now()-lastDataAt)/1000),noGrowth=Math.floor((Date.now()-lastGrowthAt)/1000);
    log(`${phase} | ${visible} | ${selected().length} calls; ${requests} requests | ${batches.length?`last response ${idle}s ago`:'no response yet'}${noGrowth>=20?`; no new calls for ${noGrowth}s (waiting)`:''} | captured ${fmt(b.oldest)} → ${fmt(b.newest)}`);
  }
  log(`START | ${zone} | buffer ${gap}ms | progress every ${progressMs/1000}s`);
  progressTimer=setInterval(()=>{if(!progressTask&&!closing){progressTask=progress().catch(()=>{}).finally(()=>{progressTask=null})}},progressMs);

  const isList=u=>{const x=new URL(u);return (x.hostname==='openmhz.com'||x.hostname.endsWith('.openmhz.com'))&&x.pathname.startsWith(`/${system}/calls`)};
  const fail=e=>{failure ||= String(e)};
  const check=()=>{if(failure)throw Error(failure)};
  const bounds=()=>{const t=[...calls.values()].map(c=>Date.parse(c.time));return {oldest:Math.min(...t),newest:Math.max(...t)}};
  const selected=()=>[...calls.values()].filter(c=>Date.parse(c.time)>=start&&Date.parse(c.time)<end).sort((a,b)=>Date.parse(a.time)-Date.parse(b.time)||a._id.localeCompare(b._id));
  async function checkpoint(){const dest=path.join(out,'calls.json');await fs.writeFile(dest,JSON.stringify({date,timezone:zone,system,talkgroup:tg,calls:selected()},null,2)+'\n')}
  async function waitFor(pred){const deadline=Date.now()+45000;while(!pred()){check();if(Date.now()>deadline)throw Error('Pagination stalled; completeness has NOT been established');await sleep(100)}check()}
  try {
    browser=await chromium.launch({headless:!args.headed,...(args.proxy?{proxy:{server:String(args.proxy)}}:{}),...(args['executable-path']?{executablePath:String(args['executable-path'])}:{})});
    const context=await browser.newContext({ignoreHTTPSErrors:!!args['ignore-https-errors'],timezoneId:zone,viewport:{width:1280,height:800}});page=await context.newPage();
    await context.route('**/*',async route=>{
      const req=route.request();if(req.resourceType()==='media'||/\.(m4a|mp3|wav|aac|ogg)(?:[?#]|$)/i.test(req.url()))return route.abort();
      if(!isList(req.url()))return route.continue();
      const task=queue.then(async()=>{
        if(closing||failure)return route.abort();
        if(++requests>Number(args['max-requests']||500)){fail('Request cap reached');return route.abort()}
        await route.continue();
        const response=await req.response();if(response)await response.finished();
        // Buffer begins AFTER the preceding response finishes, not at request start.
        await sleep(gap);
      });queue=task.catch(e=>fail(e.message));await queue;
    });
    page.on('response',response=>{
      if(!isList(response.url())||closing)return;
      const task=(async()=>{
        if(!response.ok())throw Error(`HTTP ${response.status()} on call list; stopped. Retry-After: ${response.headers()['retry-after']||'none'}`);
        const data=await response.json();if(!Array.isArray(data.calls))throw Error('Unexpected call-list response');
        const beforeCount=calls.size;
        for(const c of data.calls){if(Number(c.talkgroupNum)!==tg||!c._id||!Number.isFinite(Date.parse(c.time)))throw Error('Unexpected call metadata');calls.set(c._id,c)}
        batches.push({url:response.url(),status:response.status(),receivedAt:new Date().toISOString(),calls:data.calls});
        lastDataAt=Date.now();if(calls.size>beforeCount)lastGrowthAt=lastDataAt;
      })().catch(e=>fail(e.message));pending.add(task);task.finally(()=>pending.delete(task));
    });
    page.on('requestfailed',req=>{if(!closing&&isList(req.url()))fail(`Call-list request failed: ${req.failure()?.errorText}`)});
    phase='loading page';
    const nav=await page.goto(pageUrl,{waitUntil:'domcontentloaded',timeout:60000});
    if(nav&&!nav.ok()&&args.headed&&(await nav.allHeaders())['cf-mitigated']==='challenge'){
      phase='waiting for manual browser verification';
      log('Cloudflare verification: complete it in the visible browser. Waiting up to 5 minutes; no automatic challenge solving.');
      try {
        await page.locator('#calls tbody tr[data-callid]').first().waitFor({state:'visible',timeout:300000});
        log('OpenMHz call rows loaded after manual verification');
      }catch{
        // Keep the original HTTP diagnostics when verification does not finish.
      }
    }
    if(nav&&!nav.ok()&&!(args.headed&&await page.locator('#calls tbody tr[data-callid]').count())){
      console.error('HTTP:',nav.status(),nav.statusText());
      // Diagnostic failures must not hide the original navigation error.
      try {
        const headers=await nav.allHeaders();
        console.error('Headers:',JSON.stringify(headers,null,2));
        await fs.writeFile(path.join(out,'navigation-error-headers.json'),JSON.stringify(headers,null,2)+'\n');
      }catch(e){console.error('Could not capture response headers:',e.message)}
      try {
        const body=await nav.text();
        console.error('Body:',body.slice(0,8000));
        await fs.writeFile(path.join(out,'navigation-error-body.txt'),body);
      }catch(e){console.error('Could not capture response body:',e.message)}
      try {
        await page.screenshot({path:path.join(out,'navigation-error.png'),fullPage:true,timeout:10000});
      }catch(e){console.error('Could not capture navigation screenshot:',e.message)}
      throw Error(`Navigation HTTP ${nav.status()}`);
    }
    await waitFor(()=>batches.length>0);await page.locator('#calls tbody tr[data-callid]').first().waitFor({timeout:15000});
    const autoplay=page.locator('.button-item.active').filter({hasText:'Autoplay'});if(await autoplay.count())await autoplay.click();
    for(const direction of ['older','newer']){
      phase=`scrolling ${direction}`;log(phase);
      const reached=()=>direction==='older'?bounds().oldest<start:bounds().newest>=end;
      for(let i=0;!reached()&&i<Number(args['max-scrolls']||500);i++){
        check();await queue;await checkpoint();
        const before=calls.size;
        await page.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight/2));await sleep(100);
        await page.evaluate(d=>window.scrollTo(0,d==='older'?document.documentElement.scrollHeight:0),direction);
        await waitFor(()=>calls.size>before);
      }
      if(!reached())throw Error(`Did not cross ${direction} midnight boundary`);
      log(`${direction} midnight boundary reached`);
    }
    await Promise.all([...pending]);check();
  }catch(e){fail(e.message)}finally{
    closing=true;clearInterval(progressTimer);if(progressTask)await progressTask;phase='saving results';if(browser)await browser.close();await Promise.allSettled([...pending]);await checkpoint();
    await fs.writeFile(path.join(out,'browser-batches.json'),JSON.stringify(batches,null,2)+'\n');
    const b=bounds();const summary={date,timezone:zone,system,talkgroup:tg,pageUrl,startedAt:begun,finishedAt:new Date().toISOString(),status:failure?'incomplete':'complete',error:failure,count:selected().length,listRequests:requests,bufferAfterResponseMs:gap,olderBoundaryReached:b.oldest<start,newerBoundaryReached:b.newest>=end,audioDownloaded:false};
    await fs.writeFile(path.join(out,'summary.json'),JSON.stringify(summary,null,2)+'\n');log(`${failure?'INCOMPLETE':'COMPLETE'} | ${summary.count} unique calls | ${requests} requests | both midnight boundaries ${summary.olderBoundaryReached&&summary.newerBoundaryReached?'reached':'not reached'} | results: ${out}`);
  }
  if(failure)throw Error(failure);
}
module.exports={midnight,nextDate,validateDate};
if(require.main===module)(async()=>{const start=String(args.date||args.from||'2026-10-29'),end=String(args.to||start);validateDate(start);validateDate(end);if(!/^\d{4}-\d{2}-\d{2}$/.test(start)||!/^\d{4}-\d{2}-\d{2}$/.test(end)||start>end)throw Error('Use --date=YYYY-MM-DD or --from=... --to=...');for(let d=start;d<=end;d=nextDate(d))await collect(d)})().catch(e=>{console.error(`ERROR: ${e.message.split('\n')[0]}`);process.exitCode=1});
