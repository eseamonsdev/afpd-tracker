(() => {
  const $=id=>document.getElementById(id),params=new URL(location.href).searchParams;
  const id=params.get('evidence'),save=$('evidence-save'),status=$('evidence-save-status');
  const reviewed=$('evidence-reviewed'),notes=$('evidence-notes');
  const talkgroup=$('evidence-talkgroup');
  const pencil=$('evidence-edit-transcript'),editor=$('evidence-transcript-editor');
  const textarea=$('evidence-transcript-input'),verified=$('evidence-verified'),text=$('evidence-transcript-text');
  const speakerConfirmed=$('evidence-speaker-confirmed'),speakerLabel=$('evidence-speaker-confirmed-label');
  let group=null,clips=[],removed=new Set(),originalMembers='',transcripts=new Map(),selected=null,player=null,saving=false,adding=false;
  const memberState=()=>JSON.stringify(clips.filter(c=>!removed.has(c.id)).map(c=>({id:c.id,speaker_confirmed:c.speaker_confirmed})));
  const dirty=()=>group && (Number(talkgroup.value)!==group.talkgroup_number||reviewed.checked!==group.reviewed||notes.value!==group.correction_notes||memberState()!==originalMembers||transcripts.size>0);
  function refresh(message){
    save.disabled=saving||adding||!dirty();
    status.textContent=message||(dirty()?'Unsaved changes.':'No unsaved changes.');
    if(group)$('evidence-selection-status').textContent=`${clips.length-removed.size} evidence clips · ${clips.filter(c=>!removed.has(c.id)&&c.speaker_confirmed).length} confirmed speaker clips`;
    syncSpeakerConfirmation();
    if(group){
      talkgroup.disabled=saving||adding||clips.some(c=>!removed.has(c.id))||group.missing_clip_ids.length>0;
      reviewed.disabled=saving||Number(talkgroup.value)!==group.talkgroup_number;
      const name={5922:'Law 2 Northeast',6001:'Car-to-Car',6036:'AFPD historical'}[talkgroup.value]||'Talkgroup';
      $('evidence-context').textContent=`${group.archive_date} · ${name} (${talkgroup.value}) · ${group.source_status}`;
      $('evidence-talkgroup-help').textContent=clips.some(c=>!removed.has(c.id))?'Remove the selected evidence clips before choosing a different talkgroup. Existing recordings and transcripts are retained.':'Choose the correct talkgroup, then add clips or save. Changing talkgroup resets the group to Unreviewed.';
    }
  }
  function syncSpeakerConfirmation(){
    speakerConfirmed.checked=selected?.speaker_confirmed===true;
    speakerConfirmed.disabled=!selected||removed.has(selected.id)||saving;
    speakerLabel.textContent=group?`Confirms ${group.officer_name} is speaking`:'Confirms the officer is speaking';
  }
  function stageTranscript(){
    if(!selected||saving)return;
    selected.transcript=textarea.value;selected.validated=verified.checked;
    if(selected.transcript===(selected._original.transcript??'') && selected.validated===selected._original.validated)transcripts.delete(selected.id);
    else transcripts.set(selected.id,{id:selected.id,transcript:selected.transcript,validated:selected.validated,
      expected_transcript:selected._original.transcript,expected_validated:selected._original.validated});
    player.updateTranscript();refresh();
  }
  function select(call){
    selected=call;editor.hidden=true;text.hidden=false;pencil.setAttribute('aria-expanded','false');pencil.textContent='✎ Edit transcript';
    pencil.disabled=verified.disabled=!call;textarea.value=call?.transcript||'';verified.checked=call?.validated===true;
    syncSpeakerConfirmation();
  }
  function decorate(call,row){
    const controls=document.createElement('div');controls.className='evidence-clip-controls';
    controls.addEventListener('click',event=>event.stopPropagation());
    const remove=document.createElement('button');remove.type='button';remove.textContent='Remove from evidence group';controls.append(remove);
    const refreshRow=()=>{
      const isRemoved=removed.has(call.id);row.classList.toggle('evidence-clip-removed',isRemoved);
      remove.textContent=isRemoved?'Undo removal':'Remove from evidence group';remove.classList.toggle('evidence-undo',isRemoved);
    };
    remove.addEventListener('click',()=>{if(saving)return;if(removed.has(call.id))removed.delete(call.id);else removed.add(call.id);refreshRow();refresh();});
    row.append(controls);refreshRow();
  }
  const back=params.get('return');
  if(back){try{const url=new URL(back,location.origin);if(url.origin===location.origin&&url.pathname==='/admin/association-evidence/')$('evidence-back').href=url.href;}catch{}}
  function showSources(records){
    const fragment=document.createDocumentFragment();
    for(const record of records){
      const evidence=record.evidence||record.note||record.records?.map(r=>r.evidence).filter(Boolean).join('\n');
      if(!evidence)continue;const p=document.createElement('p');p.textContent=evidence;fragment.append(p);
    }
    $('evidence-source-records').replaceChildren(fragment);
  }
  async function load(){
    const response=await fetch('/admin/api/association-evidence?'+new URLSearchParams({evidence:id}),{cache:'no-store'});
    const data=await response.json();if(!response.ok)throw new Error(data.error||'Unable to load evidence');
    group=data.group;clips=group.clips;removed=new Set();transcripts=new Map();
    for(const call of clips)call._original={transcript:call.transcript,validated:call.validated};
    originalMembers=memberState();reviewed.checked=group.reviewed;notes.value=group.correction_notes;
    talkgroup.value=String(group.talkgroup_number);
    reviewed.disabled=notes.disabled=false;$('evidence-workspace').hidden=false;
    $('evidence-heading').textContent=`${group.officer_name} · Radio ${group.radio_id}`;
    const talkgroupName={5922:'Law 2 Northeast',6001:'Car-to-Car',6036:'AFPD'}[group.talkgroup_number]||'Talkgroup';
    $('evidence-context').textContent=`${group.archive_date} · ${talkgroupName} (${group.talkgroup_number}) · ${group.source_status}`;
    showSources(group.source_records);
    if(!player)player=RadioPlayer.evidence({date:group.archive_date,onClipSelected:select,decorateRow:decorate});
    player.render(clips);refresh();
    $('evidence-action-status').textContent=group.missing_clip_ids.length?'Some saved recordings are missing from the archive database. Review the group before saving.':clips.length?'':'No clips selected. Add the evidence clip numbers above.';
  }
  reviewed.addEventListener('change',()=>refresh());notes.addEventListener('input',()=>refresh());
  talkgroup.addEventListener('change',()=>{
    if(!group||saving||adding)return;
    // The selector is available only after the previous selection is empty.
    clips=[];removed.clear();player.render(clips);reviewed.checked=false;
    $('evidence-add-numbers').value='';$('evidence-action-status').textContent='Choose clips from the selected talkgroup, or save the corrected empty group.';
    refresh();
  });
  pencil.addEventListener('click',()=>{if(!selected||saving)return;editor.hidden=!editor.hidden;text.hidden=!editor.hidden;pencil.setAttribute('aria-expanded',String(!editor.hidden));pencil.textContent=editor.hidden?'✎ Edit transcript':'Done editing';if(!editor.hidden)textarea.focus();});
  textarea.addEventListener('input',stageTranscript);verified.addEventListener('change',stageTranscript);
  speakerConfirmed.addEventListener('change',()=>{
    if(!selected||saving||removed.has(selected.id))return;
    selected.speaker_confirmed=speakerConfirmed.checked;refresh();
  });
  $('evidence-add').addEventListener('submit',async event=>{
    event.preventDefault();if(!group||saving||adding)return;
    const numbers=$('evidence-add-numbers').value.trim().replace(/^clips?\s*/i,'').replace(/\s/g,'');
    if(!/^[1-9]\d*(,[1-9]\d*)*$/.test(numbers)){$('evidence-action-status').textContent='Enter clip numbers separated by commas, for example: Clips 12, 13.';return;}
    adding=true;refresh();
    try{
      const response=await fetch('/admin/api/association-evidence?'+new URLSearchParams({evidence:id,clips:numbers,talkgroup:talkgroup.value}),{cache:'no-store'});
      const data=await response.json();if(!response.ok)throw new Error(data.error||'Unable to find clips');
      for(const call of data.clips){
        if(clips.some(c=>c.id===call.id)){removed.delete(call.id);continue;}
        call._original={transcript:call.transcript,validated:call.validated};clips.push(call);
      }
      clips.sort((a,b)=>a.clip_number-b.clip_number);player.render(clips);$('evidence-add-numbers').value='';
      $('evidence-action-status').textContent=data.missing.length?`Not found in this archive: ${data.missing.join(', ')}.`:'Clips added to this group. Save to keep the selection.';
    }catch(error){$('evidence-action-status').textContent=error.message;}
    finally{adding=false;refresh();}
  });
  save.addEventListener('click',async()=>{
    if(!dirty()||saving||adding)return;saving=true;refresh('Saving changes…');
    const controls=Array.from(document.querySelectorAll('input,textarea,button,select'));const disabled=controls.map(c=>c.disabled);controls.forEach(c=>c.disabled=true);
    try{
      if(group.missing_clip_ids.length)throw new Error('This group has missing recordings. Resolve them before saving to preserve its membership.');
      const response=await fetch('/admin/api/association-evidence',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:group.id,revision:group.revision,
        talkgroup_number:Number(talkgroup.value),reviewed:reviewed.checked,correction_notes:notes.value,clips:JSON.parse(memberState()),transcripts:[...transcripts.values()]})});
      const data=await response.json();if(!response.ok){
        if(data.conflict_evidence_id){
          const link=document.createElement('a'),url=new URL(location.href);url.searchParams.set('evidence',data.conflict_evidence_id);
          link.href=url.pathname+url.search;link.textContent='Open the existing evidence group';$('evidence-action-status').replaceChildren(link);
        }
        throw new Error(data.error||'Save failed');
      }
      group.revision=data.revision;group.talkgroup_number=data.talkgroup_number;group.reviewed=data.reviewed;reviewed.checked=data.reviewed;group.correction_notes=notes.value;
      group.source_records=data.source_records;showSources(group.source_records);
      clips=clips.filter(c=>!removed.has(c.id));removed.clear();originalMembers=memberState();
      for(const c of clips)c._original={transcript:c.transcript,validated:c.validated};transcripts.clear();
      saving=false;player.render(clips);refresh('Changes saved.');
    }catch(error){refresh(error.message+' Your unsaved edits are still here.');}
    finally{saving=false;controls.forEach((c,i)=>c.disabled=disabled[i]);pencil.disabled=verified.disabled=!selected;syncSpeakerConfirmation();talkgroup.disabled=adding||clips.some(c=>!removed.has(c.id))||group.missing_clip_ids.length>0;reviewed.disabled=Number(talkgroup.value)!==group.talkgroup_number;save.disabled=!dirty();}
  });
  window.addEventListener('beforeunload',event=>{if(dirty()){event.preventDefault();event.returnValue='';}});
  if(!id){status.textContent='Choose an evidence group from the association evidence page.';return;}
  load().catch(error=>{status.textContent=error.message;});
})();
