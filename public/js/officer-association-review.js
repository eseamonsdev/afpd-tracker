(() => {
  "use strict";
  const payload=JSON.parse(document.getElementById("review-data").textContent);
  const storageKey="afpd-association-personal-review-v1",saveStatus=document.getElementById("review-save-status");
  let saved={},storageError="";
  try {saved=JSON.parse(localStorage.getItem(storageKey)||"{}");}
  catch {storageError="Saved review could not be read. Export before leaving; existing storage has been left intact.";}
  const review=new AFPDReviewState(payload,saved||{});
  const reviewer=document.getElementById("reviewer-name");reviewer.value=review.state.reviewer;
  function persist() {
    if(!storageError) try {localStorage.setItem(storageKey,JSON.stringify(review.state));}
    catch {storageError="Browser storage is unavailable or full. Export before leaving.";}
    const count=(payload.clip_selections??[]).filter(c=>review.evidenceSelected(c.officer_id,c.clip_id)).length;
    saveStatus.textContent=storageError||`${count} evidence clips · ${Object.keys(review.state.transcripts).length} transcript changes · Saved in this browser`;
  }
  reviewer.addEventListener("input",()=>{review.state.reviewer=reviewer.value;persist();});
  document.getElementById("export-review").addEventListener("click",()=>{
    const blob=new Blob([JSON.stringify(review.export(),null,2)+"\n"],{type:"application/json"});
    const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;
    a.download=`afpd-association-review-${new Date().toISOString().replaceAll(":","-")}.json`;
    document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
  const selector=document.getElementById("person-select"),container=document.getElementById("officer-clips");
  const templates=new Map([...container.querySelectorAll("template[data-person]")].map(t=>[t.dataset.person,t]));
  container.replaceChildren();
  let currentPerson=null,player=null,playbackSpeed=1;
  const formatTime=seconds=>{const n=Number.isFinite(seconds)?Math.max(0,Math.floor(seconds)):0;return `${Math.floor(n/60)}:${String(n%60).padStart(2,"0")}`;};
  function initializePerson(section) {
    const officerId=section.dataset.personId,root=section.querySelector(".review-player");
    const audio=root.querySelector("audio"),play=root.querySelector('[data-action="play"]'),show=root.querySelector('[data-action="show-current"]');
    const seek=root.querySelector("[data-seek]"),speed=root.querySelector("[data-speed]"),current=root.querySelector(".current"),message=root.querySelector(".message");
    const transcript=root.querySelector(".transcript"),text=root.querySelector(".transcript-text"),editor=root.querySelector(".transcript-editor"),area=editor.querySelector("textarea");
    const edit=root.querySelector('[data-action="edit-transcript"]'),clips=[...section.querySelectorAll(".clip")];
    let selected=null,generation=0;
    speed.value=String(playbackSpeed);
    function canLeave() {
      if(selected&&!editor.hidden&&area.value!==review.transcript(selected.dataset.clipId)) {
        message.textContent="Save or cancel your transcript edit before switching clips or people.";return false;
      }
      return true;
    }
    function closeEditor() {editor.hidden=true;text.hidden=false;edit.hidden=false;}
    function renderTranscript() {
      if(!selected)return;
      const id=selected.dataset.clipId;
      transcript.hidden=false;text.textContent=review.transcript(id)||"No transcript available.";
      root.querySelector(".transcript-status").textContent=review.state.transcripts[id]?"Personally edited transcript":selected.dataset.verified==="true"?"Previously verified transcript":"AI transcript · unverified";
    }
    function updateProgress() {
      const valid=Number.isFinite(audio.duration)&&audio.duration>0;
      seek.disabled=!valid;seek.max=valid?audio.duration:0;seek.value=valid?audio.currentTime:0;
      root.querySelector("[data-elapsed]").textContent=formatTime(audio.currentTime);
      root.querySelector("[data-duration]").textContent=formatTime(audio.duration);
      seek.setAttribute("aria-valuetext",`${formatTime(audio.currentTime)} of ${formatTime(audio.duration)}`);
    }
    function startPlayback() {
      const request=++generation;
      audio.play().catch(()=>{if(request===generation)message.textContent="Playback did not start. Press Play to try again.";});
    }
    function select(clip) {
      if(!canLeave())return;
      closeEditor();
      if(selected!==clip) {
        ++generation;audio.pause();selected=clip;audio.src=clip.dataset.source;
        updateProgress();
      }
      audio.playbackRate=playbackSpeed;
      for(const button of clips) {
        button.classList.toggle("is-current",button===clip);
        if(button===clip)button.setAttribute("aria-current","true");else button.removeAttribute("aria-current");
      }
      const day=clip.closest("[data-day]");
      current.textContent=`${day.dataset.date} · ${day.dataset.talkgroup} · ${clip.children[0].textContent.trim()} · ${clip.children[1].textContent.trim()}`;
      play.disabled=false;show.disabled=false;message.textContent="";renderTranscript();startPlayback();
    }
    for(const clip of clips) {
      const row=clip.closest("li"),check=row.querySelector("[data-clip-evidence]");
      function refreshEvidence() {
        check.checked=review.evidenceSelected(officerId,clip.dataset.clipId);
        row.classList.toggle("is-evidence",check.checked);
      }
      refreshEvidence();
      check.addEventListener("change",()=>{review.setEvidence(officerId,clip.dataset.clipId,check.checked);refreshEvidence();persist();});
      clip.addEventListener("click",()=>select(clip));
      row.addEventListener("click",event=>{if(!event.target.closest("button,input,label,a,select,textarea"))select(clip);});
    }
    play.addEventListener("click",()=>{if(!selected)return;if(audio.paused){message.textContent="";startPlayback();}else{++generation;audio.pause();}});
    show.addEventListener("click",()=>{
      if(!selected)return;selected.closest("[data-day]").open=true;
      const row=selected.closest("li"),top=row.getBoundingClientRect().top+window.scrollY;
      window.scrollTo({top:Math.max(0,top-root.getBoundingClientRect().height-28),behavior:"smooth"});
    });
    seek.addEventListener("input",()=>{if(Number.isFinite(audio.duration))audio.currentTime=Math.min(audio.duration,Math.max(0,Number(seek.value)));});
    speed.addEventListener("change",()=>{playbackSpeed=Number(speed.value);audio.playbackRate=playbackSpeed;});
    for(const event of ["loadedmetadata","durationchange","timeupdate","emptied"])audio.addEventListener(event,updateProgress);
    audio.addEventListener("play",()=>{play.textContent="Pause";play.setAttribute("aria-label","Pause selected clip");});
    audio.addEventListener("pause",()=>{play.textContent="Play";play.setAttribute("aria-label","Play selected clip");});
    audio.addEventListener("ended",()=>{play.textContent="Play";play.setAttribute("aria-label","Play selected clip");});
    audio.addEventListener("error",()=>{message.textContent="This recording could not be loaded. Try the full archive day link.";});
    edit.addEventListener("click",()=>{if(!selected)return;area.value=review.transcript(selected.dataset.clipId);editor.hidden=false;text.hidden=true;edit.hidden=true;area.focus();});
    root.querySelector('[data-action="save-transcript"]').addEventListener("click",()=>{if(!selected)return;review.saveTranscript(selected.dataset.clipId,area.value);persist();closeEditor();renderTranscript();});
    root.querySelector('[data-action="cancel-transcript"]').addEventListener("click",closeEditor);
    return {canLeave,destroy(){++generation;audio.pause();audio.removeAttribute("src");audio.load();}};
  }
  function showPerson(id) {
    const template=templates.get(id);if(!template)return false;
    if(currentPerson===id)return true;
    if(player&&!player.canLeave()){selector.value=currentPerson;return false;}
    player?.destroy();
    container.replaceChildren(template.content.cloneNode(true));currentPerson=id;selector.value=id;
    const section=container.firstElementChild;player=initializePerson(section);
    document.getElementById("selection-status").textContent=section.querySelector("h2").textContent+" · "+section.querySelector(".person-meta").textContent.split(" · Back to people")[0];
    return true;
  }
  selector.addEventListener("change",()=>{if(showPerson(selector.value))history.replaceState(null,"","#"+selector.value);});
  function revealHash() {
    let id;try{id=decodeURIComponent(location.hash.slice(1));}catch{return;}
    let target=document.getElementById(id);
    if(!target) {
      const template=templates.get(id)??[...templates.values()].find(t=>t.content.getElementById(id));
      if(!template||!showPerson(template.dataset.person))return;
      target=document.getElementById(id);
    }
    if(!target)return;
    const day=target.closest("[data-day]");if(day)day.open=true;
    target.scrollIntoView({block:"start"});
  }
  addEventListener("hashchange",revealHash);
  if(location.hash)revealHash();
  if(!currentPerson&&selector.value)showPerson(selector.value);
  persist();
})();
