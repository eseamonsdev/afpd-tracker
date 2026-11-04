const test=require('node:test'),assert=require('node:assert/strict');
const {midnight,nextDate,validateDate}=require('./collect-openmhz.cjs');
const {sourceIds,compare}=require('./audit-talkgroups.cjs');
test('Mountain midnight covers DST days correctly',()=>{assert.equal(midnight('2026-03-09')-midnight('2026-03-08'),23*3600000);assert.equal(midnight('2025-11-03')-midnight('2025-11-02'),25*3600000);assert.equal(midnight('2026-10-30'),Date.parse('2026-10-30T06:00:00Z'));assert.equal(nextDate('2026-12-31'),'2027-01-01')});
test('calendar validation rejects normalized and malformed dates',()=>{for(const d of ['2026-02-30','bad','2026-13-01'])assert.throws(()=>validateDate(d));assert.equal(validateDate('2026-10-29'),'2026-10-29')});
test('every source entry is compared with exact matching and placeholders excluded',()=>{const c={_id:'call',time:'2026-10-29T12:00:00Z',srcList:[{src:14570735,pos:0},{src:13230584,pos:2.16},{src:0,pos:4}],radio_ids:['13230584','-1']};assert.deepEqual(sourceIds(c),['14570735','13230584']);const r=compare([c],new Set(['13230584','0']));assert.equal(r.matching_calls,1);assert.deepEqual(r.distinct_matching_ids,['13230584']);assert.equal(compare([c],new Set(['1323058'])).matching_calls,0)});

const {openSession}=require('./browser-session.cjs');
function browserMock(){
 const calls=[];
 const page={isClosed:()=>false,close:async()=>calls.push('page.close')};
 const context={newPage:async()=>{calls.push('newPage');return page},close:async()=>{throw Error('Must not close shared context')}};
 const browser={contexts:()=>[context],newContext:async options=>{calls.push(['newContext',options]);return context},close:async()=>calls.push('disconnect')};
 const chromium={connectOverCDP:async url=>{calls.push(['connect',url]);return browser},launch:async options=>{calls.push(['launch',options]);return browser}};
 return {calls,page,browser,chromium};
}
test('default attachment reuses profile and cleans up only its tab before disconnecting',async()=>{
 const m=browserMock();const s=await openSession(m.chromium,{},'America/Denver');
 assert.equal(s.attached,true);assert.equal(s.visible,true);assert.equal(s.page,m.page);
 assert.deepEqual(m.calls,[['connect','http://127.0.0.1:9222'],'newPage']);
 await s.close();assert.deepEqual(m.calls.slice(-2),['page.close','disconnect']);
});
test('custom CDP endpoint is honored and failed attachment never falls back to launch',async()=>{
 const m=browserMock();await openSession(m.chromium,{'cdp-url':'http://127.0.0.1:9333'},'UTC');
 assert.deepEqual(m.calls[0],['connect','http://127.0.0.1:9333']);
 m.chromium.connectOverCDP=async()=>{throw Error('ECONNREFUSED')};m.calls.length=0;
 await assert.rejects(openSession(m.chromium,{},'UTC'),/Start Chromium.*--launch-browser/);assert.deepEqual(m.calls,[]);
});
test('explicit launch retains previous browser settings and rejects mixed connection options',async()=>{
 const m=browserMock();const s=await openSession(m.chromium,{'launch-browser':true,headed:true,'executable-path':'/usr/bin/chromium'},'America/Denver');
 assert.equal(s.attached,false);assert.deepEqual(m.calls[0],['launch',{headless:false,executablePath:'/usr/bin/chromium'}]);
 assert.equal(m.calls[1][1].timezoneId,'America/Denver');await s.close();
 await assert.rejects(openSession(m.chromium,{'launch-browser':true,'cdp-url':'http://localhost:9222'},'UTC'),/either/);
 await assert.rejects(openSession(m.chromium,{proxy:'http://localhost:1234'},'UTC'),/require --launch-browser/);
});
test('setup failure and tab-close failure still disconnect the client',async()=>{
 const m=browserMock();m.browser.contexts=()=>[];
 await assert.rejects(openSession(m.chromium,{},'UTC'),/no existing browser context/);assert.equal(m.calls.at(-1),'disconnect');
 const n=browserMock();const s=await openSession(n.chromium,{},'UTC');n.page.close=async()=>{throw Error('already disconnected')};
 await assert.rejects(s.close(),/already disconnected/);assert.equal(n.calls.at(-1),'disconnect');
});
