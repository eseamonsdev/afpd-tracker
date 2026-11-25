// Only the admin full-day page loads this adapter. It never configures or
// modifies the shared player, and evidence failures do not block transcripts.
(() => {
  const root=document.getElementById('radio-archive');
  const dialog=document.getElementById('admin-evidence-dialog');
  if(!root||!dialog)return;
  const $=id=>document.getElementById(id),feedback=$('admin-evidence-feedback');
  const form=$('admin-evidence-form'),officer=$('admin-evidence-officer'),radio=$('admin-evidence-radio');
  const numbers=$('admin-evidence-numbers'),submit=$('admin-evidence-add'),result=$('admin-evidence-result');
  let day=null,selected=null,openButton=null,currentLinks=null,controller=null,generation=0,saving=false;

  function ensureControls(){
    if(openButton)return;
    const controls=$('radio-player-panel')?.querySelector('.admin-radio-controls');
    if(!controls)return;
    openButton=document.createElement('button');openButton.id='admin-evidence-open';openButton.type='button';
    openButton.textContent='Add to association evidence';openButton.disabled=true;
    currentLinks=document.createElement('div');currentLinks.id='admin-evidence-current-links';
    controls.append(openButton,currentLinks);openButton.addEventListener('click',openDialog);
  }
  function refreshButton(){if(openButton)openButton.disabled=!selected||!day?.metadata||saving;}
  function evidenceUrl(id){
    const url=new URL('/admin/evidence-excerpt/',location.origin);url.searchParams.set('evidence',id);
    url.searchParams.set('return',location.pathname+location.search);return url.pathname+url.search;
  }
  function linksFor(clipId){
    const memberships=day?.metadata?.memberships.filter(m=>m.clip_id===clipId)||[];
    if(!memberships.length)return null;
    const links=document.createElement('div');links.className='admin-evidence-links';
    const caption=document.createElement('span');caption.className='admin-evidence-caption';caption.textContent='Evidence for:';links.append(caption);
    for(const group of memberships){
      const link=document.createElement('a');link.href=evidenceUrl(group.evidence_id);
      link.textContent=`${group.officer_name} · Radio ${group.radio_id}`;links.append(link);
    }
    return links;
  }
  function renderLinks(){
    if(!day)return;
    day.rows.forEach((row,index)=>{
      for(const old of row.querySelectorAll('.admin-evidence-links'))old.remove();
      const links=linksFor(day.calls[index].id);if(links)row.append(links);
    });
    renderCurrentLinks();
  }
  function renderCurrentLinks(){
    if(!currentLinks)return;currentLinks.replaceChildren();
    if(selected){const links=linksFor(selected.id);if(links)currentLinks.append(links);}
  }
  function setOptions(){
    const previous=officer.value;
    officer.replaceChildren(new Option('Choose an officer',''),...day.metadata.officers.map(o=>new Option(o.officer_name,o.officer_key)));
    if(day.metadata.officers.some(o=>o.officer_key===previous))officer.value=previous;
    $('admin-evidence-radios').replaceChildren(...day.metadata.radio_ids.map(id=>new Option(id,id)));
  }
  async function loadMemberships(){
    const active=day,token=generation;if(!active)return;
    controller?.abort();controller=new AbortController();
    try{
      const url='/admin/api/radio-evidence?'+new URLSearchParams({date:active.date,talkgroup:String(active.talkgroup)});
      const response=await fetch(url,{cache:'no-store',signal:controller.signal});const data=await response.json();
      if(day!==active||generation!==token)return;
      if(!response.ok)throw new Error(data.error||'Evidence links unavailable');
      active.metadata=data;setOptions();renderLinks();refreshButton();feedback.hidden=true;
    }catch(error){
      if(error.name==='AbortError'||day!==active||generation!==token)return;
      feedback.hidden=false;feedback.replaceChildren(document.createTextNode('Evidence links are unavailable. Playback and transcript editing remain available. '));
      const retry=document.createElement('button');retry.type='button';retry.textContent='Retry evidence';retry.addEventListener('click',loadMemberships);feedback.append(retry);
    }
  }
  function selection(){
    const raw=numbers.value.trim().replace(/^clips?\s*/i,'').replace(/\s/g,'');
    if(!/^[1-9]\d*(,[1-9]\d*)*$/.test(raw))return {error:'Enter comma-separated clip numbers, for example 12, 13.'};
    const requested=[...new Set(raw.split(',').map(Number))];
    if(requested.length>250)return {error:'Choose up to 250 clips at a time.'};
    const missing=requested.filter(n=>!Number.isSafeInteger(n)||n>day.calls.length);
    if(missing.length)return {error:'Clip numbers not found on this day: '+missing.join(', ')};
    return {clips:requested.sort((a,b)=>a-b).map(number=>({number,call:day.calls[number-1]}))};
  }
  function preview(){
    if(!day)return;
    const data=selection();$('admin-evidence-selection-error').textContent=data.error||'';
    submit.disabled=saving||!!data.error;
    const fragment=document.createDocumentFragment();
    for(const item of data.clips||[]){
      const li=document.createElement('li');
      const text=item.call.transcript?.trim()||'[No transcript]';
      li.textContent=`Clip ${item.number} · ${text.length>200?text.slice(0,200)+'…':text}`;fragment.append(li);
    }
    $('admin-evidence-preview').replaceChildren(fragment);
  }
  function openDialog(){
    if(!day?.metadata||!selected||saving)return;
    const number=day.calls.findIndex(c=>c.id===selected.id)+1;if(number<1)return;
    numbers.value=String(number);
    const radioIds=[...(selected.radio_ids||[]),...(selected.srcList||[]).map(r=>r.src)].map(String).filter(id=>/^[1-9]\d*$/.test(id));
    radio.value=radioIds[0]||'';
    $('admin-evidence-day').textContent=`${day.date} · ${day.talkgroup===5922?'Law 2 Northeast':'Car-to-Car'} (${day.talkgroup})`;
    result.replaceChildren();preview();dialog.showModal();officer.focus();
  }
  numbers.addEventListener('input',preview);
  $('admin-evidence-cancel').addEventListener('click',()=>{if(!saving)dialog.close();});
  dialog.addEventListener('cancel',event=>{if(saving)event.preventDefault();});
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(!day||saving||!form.reportValidity())return;
    const chosen=selection();if(chosen.error){preview();return;}
    const active=day,chosenOfficer=officer.value,chosenRadio=radio.value.trim();
    saving=true;refreshButton();result.textContent='Adding evidence…';
    const controls=Array.from(dialog.querySelectorAll('input,select,button'));
    controls.forEach(c=>c.disabled=true);
    try{
      const response=await fetch('/admin/api/radio-evidence',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({action:'append',officer_key:chosenOfficer,radio_id:chosenRadio,date:active.date,talkgroup:active.talkgroup,clip_ids:chosen.clips.map(item=>item.call.id)})});
      const data=await response.json();if(!response.ok)throw new Error(data.error||'Unable to add evidence');
      if(day!==active)return;
      const summary=data.added?`Added ${data.added} new clip${data.added===1?'':'s'} to ${data.created?'a new':'the existing'} evidence group. The group is Unreviewed. `:
        'These clips already belong to the evidence group. No changes were made. ';
      result.replaceChildren(document.createTextNode(summary));
      const link=document.createElement('a');link.href=evidenceUrl(data.evidence_id);link.textContent='Open evidence group';result.append(link);
      await loadMemberships();
    }catch(error){if(day===active)result.textContent=error.message;}
    finally{saving=false;controls.forEach(c=>c.disabled=false);refreshButton();preview();}
  });
  root.addEventListener('admin-radio-day-ready',event=>{
    const {calls,list,entry,talkgroup}=event.detail;
    generation++;controller?.abort();selected=null;
    day={calls,rows:Array.from(list.children),date:entry.date,talkgroup,metadata:null};
    officer.value='';ensureControls();refreshButton();renderCurrentLinks();loadMemberships();
  });
  root.addEventListener('admin-radio-clip-selected',event=>{
    selected=event.detail.call;
    if(!selected){generation++;controller?.abort();day=null;if(dialog.open&&!saving)dialog.close();}
    ensureControls();refreshButton();renderCurrentLinks();
  });
  window.addEventListener('pageshow',event=>{if(event.persisted&&day&&!saving)loadMemberships();});
})();
