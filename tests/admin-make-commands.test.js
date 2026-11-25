import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import nunjucks from 'nunjucks';
import makeCommands from '../src/_data/makeCommands.js';

const workflows=JSON.parse(fs.readFileSync('src/_data/commandWorkflows.json','utf8'));
const adminTools=JSON.parse(fs.readFileSync('src/_data/adminTools.json','utf8'));
const env=new nunjucks.Environment(new nunjucks.FileSystemLoader(['src','src/_includes']),{autoescape:true});

test('command guide renders ordered workflows, unique copy panels, dashboard access and current Make help',()=>{
  const commands=makeCommands();
  const html=env.render('admin-make-commands.njk',{commandWorkflows:workflows,adminTools,makeCommands:commands});
  assert.match(html,/<h1>Make Commands<\/h1>/);
  const panelIds=[...html.matchAll(/<code id="([^"]+)">/g)].map(m=>m[1]);
  assert.equal(panelIds.length,workflows.reduce((n,w)=>n+w.steps.length,0));
  assert.equal(new Set(panelIds).size,panelIds.length);
  for(const id of panelIds)assert.ok(html.includes(`data-copy-target="${id}"`));
  for(const command of commands)assert.ok(html.includes(`make ${command.name}</code>`));
  assert.match(env.render('admin-index.njk',{adminTools}),/href="\/admin\/make-commands\/"/);
  assert.match(html,/href="\/admin\/make-commands\/" aria-current="page"/);
  const targets=new Set(commands.map(c=>c.name));
  for(const workflow of workflows)for(const step of workflow.steps){
    for(const [,target] of step.commands.matchAll(/(?:^|\n)make ([\w-]+)/g))assert.ok(targets.has(target),target);
    assert.doesNotMatch(step.commands,/D1_DATABASE|--database|git push --force/);
  }
  const save=workflows.find(w=>w.id==='save-admin-edits').steps.map(s=>s.commands).join('\n');
  for(const [before,after] of [['git pull','make calls-from-db'],['make calls-from-db','make build'],['make evidence-from-db','git commit'],['git push','make manual-deploy']])
    assert.ok(save.indexOf(before)<save.indexOf(after));
  for(const workflow of workflows.filter(w=>!w.production))assert.doesNotMatch(workflow.steps.map(s=>s.commands).join('\n'),/make (?:promote-db|prod-manual-deploy|promote-staging)(?:\s|$)/);
});

function copyHarness({clipboard=true,failure=false,fallback=false,hash=''}={}){
  const handlers={},status={textContent:''},code={textContent:'make calls-from-db &&\nmake evidence-from-db'};
  const button={dataset:{copyTarget:'commands'},hidden:true,disabled:false,textContent:'Copy',
    closest(){return {querySelector(){return status;}};},addEventListener(name,fn){handlers[name]=fn;}};
  const task={tagName:'DETAILS',open:false},writes=[],selections=[];
  const selection={removeAllRanges(){selections.push('clear');},addRange(){selections.push('select');}};
  const context={navigator:{clipboard:clipboard?{async writeText(value){if(failure)throw Error('denied');writes.push(value);}}:undefined},
    document:{querySelectorAll(){return [button];},getElementById(id){return id==='commands'?code:id==='save-admin-edits'?task:null;},
      createRange(){return {selectNodeContents(value){assert.equal(value,code);}};},execCommand(name){assert.equal(name,'copy');return fallback;}},
    window:{getSelection(){return selection;},addEventListener(){}},location:{hash}};
  vm.runInNewContext(fs.readFileSync('public/js/admin-make-commands.js','utf8'),context);
  return {button,status,code,writes,selections,task,click:()=>handlers.click()};
}
test('copy uses exactly the displayed commands and reports completion',async()=>{
  const h=copyHarness();assert.equal(h.button.hidden,false);await h.click();
  assert.deepEqual(h.writes,[h.code.textContent]);assert.equal(h.status.textContent,'Commands copied.');
  assert.equal(h.button.disabled,false);assert.equal(h.button.textContent,'Copied');
});
test('clipboard denial falls back to copy, then selects commands when manual copy is needed',async()=>{
  const fallback=copyHarness({failure:true,fallback:true});await fallback.click();
  assert.equal(fallback.status.textContent,'Commands copied.');
  const manual=copyHarness({clipboard:false});await manual.click();
  assert.match(manual.status.textContent,/Ctrl\+C/);assert.ok(manual.selections.includes('select'));
  assert.equal(manual.button.disabled,false);
});
test('task anchor opens its collapsed workflow',()=>{
  assert.equal(copyHarness({hash:'#save-admin-edits'}).task.open,true);
});
