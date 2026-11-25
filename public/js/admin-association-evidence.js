(() => {
  const $=id=>document.getElementById(id), params=new URL(location.href).searchParams;
  const filter=$('evidence-filter'),scope=$('evidence-scope'),search=$('evidence-search'),officer=$('evidence-officer');
  let selectedOfficer=params.get('officer')||'';
  filter.value=['all','reviewed','unreviewed'].includes(params.get('status'))?params.get('status'):'unreviewed';
  scope.value=params.get('scope')==='all'?'all':'website';search.value=params.get('q')||'';
  const requestedOffset=Number(params.get('offset')||0);
  let offset=Number.isSafeInteger(requestedOffset)&&requestedOffset>=0?requestedOffset:0,more=false,request=0;
  const cell=(row,text)=>{const td=document.createElement('td');td.textContent=text;row.append(td);return td;};
  async function load(){
    const token=++request;$('evidence-list-status').textContent='Loading evidence…';
    $('evidence-previous').disabled=$('evidence-next').disabled=true;
    const query=new URLSearchParams({status:filter.value,scope:scope.value,q:search.value.trim(),offset:String(offset)});
    if(selectedOfficer)query.set('officer',selectedOfficer);
    const state=new URL(location.href);state.search=query.toString();history.replaceState(null,'',state);
    try{
      const response=await fetch('/admin/api/association-evidence?'+query,{cache:'no-store'});const data=await response.json();
      if(token!==request)return;if(!response.ok)throw new Error(data.error||'Unable to load evidence');
      const options=[new Option('All officers',''),...data.officers.map(person=>new Option(person.officer_name,person.officer_key))];
      if(selectedOfficer&&!data.officers.some(person=>person.officer_key===selectedOfficer))options.push(new Option(selectedOfficer,selectedOfficer));
      officer.replaceChildren(...options);officer.value=selectedOfficer;officer.disabled=false;
      const fragment=document.createDocumentFragment();
      for(const group of data.groups){
        const row=document.createElement('tr');if(group.reviewed)row.className='is-reviewed';
        cell(row,group.radio_id);const person=cell(row,group.officer_name);const key=document.createElement('small');key.textContent=group.officer_key;person.append(key);
        const evidence=cell(row,'');const link=document.createElement('a');
        const target=new URL('/admin/evidence-excerpt/',location.origin);target.searchParams.set('evidence',group.id);
        target.searchParams.set('return',location.pathname+location.search);link.href=target.pathname+target.search;
        const talkgroupName={5922:'Law 2',6001:'Car-to-Car',6036:'AFPD'}[group.talkgroup_number]||'Talkgroup';
        link.textContent=`${group.archive_date} · ${talkgroupName} (${group.talkgroup_number})`;evidence.append(link);
        const clips=document.createElement('small');clips.textContent=group.clip_numbers?'Clips '+group.clip_numbers:'No clips selected';evidence.append(clips);
        cell(row,String(group.confirmed_clips));cell(row,group.reviewed?'Reviewed':'Unreviewed');cell(row,group.correction_notes);fragment.append(row);
      }
      $('evidence-groups').replaceChildren(fragment);more=data.has_more;
      $('evidence-progress').textContent=`${data.counts.reviewed} of ${data.counts.total} groups reviewed · ${data.counts.unreviewed} remaining`;
      $('evidence-list-status').textContent=data.groups.length?`${data.groups.length} groups shown`:'No evidence groups match these filters.';
      $('evidence-page').textContent=`Page ${Math.floor(offset/100)+1}`;
      $('evidence-previous').disabled=offset===0;$('evidence-next').disabled=!more;
    }catch(error){if(token===request)$('evidence-list-status').textContent=error.message;}
  }
  $('evidence-filters').addEventListener('submit',event=>{event.preventDefault();offset=0;load();});
  for(const control of [filter,scope])control.addEventListener('change',()=>{offset=0;load();});
  officer.addEventListener('change',()=>{selectedOfficer=officer.value;offset=0;load();});
  $('evidence-previous').addEventListener('click',()=>{offset=Math.max(0,offset-100);load();});
  $('evidence-next').addEventListener('click',()=>{if(more){offset+=100;load();}});
  window.addEventListener('pageshow',event=>{if(event.persisted)load();});load();
})();
