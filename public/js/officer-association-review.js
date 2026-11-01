(() => {
  "use strict";
  const payload=JSON.parse(document.getElementById("review-data").textContent);
  const storageKey="afpd-association-personal-review-v1", saveStatus=document.getElementById("review-save-status");
  let saved={}, storageError="";
  try { saved=JSON.parse(localStorage.getItem(storageKey) || "{}"); }
  catch { storageError="Saved review could not be read. Changes are held in memory; export before leaving. Existing storage has been left intact."; }
  const review=new AFPDReviewState(payload,saved || {});
  const reviewer=document.getElementById("reviewer-name");reviewer.value=review.state.reviewer;
  function persist() {
    if(!storageError) try { localStorage.setItem(storageKey,JSON.stringify(review.state)); }
    catch { storageError="Browser storage is unavailable or full. Changes are held in memory; export before leaving."; }
    saveStatus.textContent=storageError || `${Object.keys(review.state.transcripts).length} transcript changes · ${Object.keys(review.state.confirmations).length} personally confirmed associations · Saved in this browser`;
  }
  reviewer.addEventListener("input",()=>{review.state.reviewer=reviewer.value;persist();});
  document.getElementById("export-review").addEventListener("click",()=>{
    const blob=new Blob([JSON.stringify(review.export(),null,2)+"\n"],{type:"application/json"});
    const url=URL.createObjectURL(blob), a=document.createElement("a");a.href=url;
    a.download=`afpd-association-review-${new Date().toISOString().replaceAll(":","-")}.json`;
    document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
  let activeAudio=null;
  function initializePerson(section) {
    for(const row of section.querySelectorAll("[data-evidence-key]")) {
      const key=row.dataset.evidenceKey, checkbox=row.querySelector("[data-confirm]"), status=row.querySelector(".confirmation-status");
      const person=row.querySelector("[data-confirm-person]"),radio=row.querySelector("[data-confirm-radio]");
      const checks=[...row.querySelectorAll("[data-evidence-clip]")];
      const existing=review.state.confirmations[key];
      if(existing) {
        person.value=existing.officer_id;radio.value=existing.radio_id;
        checks.forEach(c=>c.checked=existing.clip_ids.includes(c.dataset.evidenceClip));checkbox.checked=true;
        status.textContent=`Personally confirmed by ${existing.confirmed_by} · ${existing.confirmed_at}`;
      }
      for(const input of [person,radio,...checks]) input.addEventListener("change",()=>{
        if(checkbox.checked) { checkbox.checked=false;review.unconfirm(key);status.textContent="Evidence selection changed. Confirm again after review.";persist(); }
      });
      checkbox.addEventListener("change",()=>{
        if(checkbox.checked) try {
          review.confirm(key,{record_id:row.dataset.recordId,officer_id:person.value,radio_id:radio.value.trim(),date:row.dataset.date,talkgroup:Number(row.dataset.talkgroup),clip_ids:checks.filter(c=>c.checked).map(c=>c.dataset.evidenceClip)});
          status.textContent=`Personally confirmed by ${review.state.reviewer.trim()}`;
        } catch(error) {checkbox.checked=false;status.textContent=error.message;return;}
        else {review.unconfirm(key);status.textContent="Pending personal verification";}
        persist();
      });
    }
    const transcriptRenderers=[];
    const players = [...section.querySelectorAll("[data-day]")];
    for (const day of players) {
      const audio = day.querySelector("audio"), clips = [...day.querySelectorAll("button[data-source]")];
      const previous = day.querySelector('[data-action="previous"]'), next = day.querySelector('[data-action="next"]');
      const current = day.querySelector(".current"), message = day.querySelector(".message"), recording = day.querySelector(".recording");
      const transcript = day.querySelector(".transcript"), toggle = day.querySelector('[data-action="transcript"]');
      const speed = day.querySelector("[data-speed]");
      const editor=day.querySelector(".transcript-editor"), area=editor.querySelector("textarea"), text=day.querySelector(".transcript-text");
      const edit=day.querySelector('[data-action="edit-transcript"]');
      let index = -1, generation = 0, editingId=null;
      function renderTranscript() {
        if(index<0) return;
        const clip=clips[index],id=clip.dataset.clipId;
        text.textContent=review.transcript(id) || "No transcript available.";
        day.querySelector(".transcript-status").textContent=review.state.transcripts[id] ? "Personally edited transcript · association confirmation is separate" : clip.dataset.verified==="true" ? "Previously verified transcript" : "AI transcript · unverified";
        edit.disabled=false;
      }
      transcriptRenderers.push(renderTranscript);
      function closeEditor() {editor.hidden=true;text.hidden=false;edit.hidden=false;editingId=null;}
      edit.addEventListener("click",()=>{if(index<0)return;editingId=clips[index].dataset.clipId;area.value=review.transcript(editingId);editor.hidden=false;text.hidden=true;edit.hidden=true;area.focus();});
      day.querySelector('[data-action="save-transcript"]').addEventListener("click",()=>{if(!editingId)return;review.saveTranscript(editingId,area.value);persist();closeEditor();transcriptRenderers.forEach(render=>render());});
      day.querySelector('[data-action="cancel-transcript"]').addEventListener("click",closeEditor);
      function select(number, play = true) {
        if (!Number.isInteger(number) || number < 0 || number >= clips.length) return;
        if(editingId && area.value!==review.transcript(editingId)) {message.textContent="Save or cancel your transcript edit before switching clips.";return;}
        closeEditor();
        const clip = clips[number], selected = ++generation;
        if (index !== number) {
          audio.pause(); index = number; audio.src = clip.dataset.source;
        }
        audio.playbackRate = Number(speed.value);
        clips.forEach((button, n) => { button.classList.toggle("is-current",n===index); if (n===index) button.setAttribute("aria-current","true"); else button.removeAttribute("aria-current"); });
        current.textContent = `${clip.children[0].textContent.trim()} · Radio ${clip.children[1].textContent.trim()}`; previous.disabled = index===0; next.disabled = index===clips.length-1;
        renderTranscript();
        day.querySelector(".call-note").textContent = clip.dataset.note;
        recording.href = clip.dataset.source; recording.hidden = false; message.textContent = "";
        if (play) audio.play().catch(() => { if (selected !== generation) return; message.textContent = "Playback did not start. Use the audio Play control or open the selected recording."; });
      }
      clips.forEach((clip, n) => clip.addEventListener("click", () => select(n)));
      day.querySelector('[data-action="play-day"]').addEventListener("click", () => select(0));
      previous.addEventListener("click", () => select(index-1)); next.addEventListener("click", () => select(index+1));
      speed.addEventListener("change", () => { audio.playbackRate = Number(speed.value); });
      audio.addEventListener("play", () => {
        if(activeAudio && activeAudio!==audio) activeAudio.pause();
        activeAudio=audio;
      });
      audio.addEventListener("ended", () => { if(day.querySelector("[data-autoplay]").checked && index+1<clips.length) select(index+1); });
      audio.addEventListener("error", () => { message.textContent = "This recording could not be loaded. Try the selected recording link or the full archive day."; });
      toggle.addEventListener("click", () => { transcript.hidden=!transcript.hidden; toggle.textContent=transcript.hidden ? "Transcript: Off" : "Transcript: On"; toggle.setAttribute("aria-pressed", String(!transcript.hidden)); });
    }
  }
  persist();
  const selector=document.getElementById("person-select"), container=document.getElementById("officer-clips");
  const templates=new Map([...container.querySelectorAll("template[data-person]")].map(template=>[template.dataset.person,template]));
  // Keep all source markup inert; only the selected person's controls enter the live DOM.
  container.replaceChildren();
  let currentPerson=null;
  function showPerson(id) {
    const template=templates.get(id);
    if(!template) return false;
    if(currentPerson===id) return true;
    for(const editor of container.querySelectorAll(".transcript-editor:not([hidden])")) {
      const day=editor.closest("[data-day]"), clip=day.querySelector(".clip.is-current");
      if(clip && editor.querySelector("textarea").value!==review.transcript(clip.dataset.clipId)) {
        selector.value=currentPerson;
        document.getElementById("selection-status").textContent="Save or cancel your transcript edit before switching people.";
        return false;
      }
    }
    if(activeAudio) {
      activeAudio.pause();
      activeAudio.removeAttribute("src");
      activeAudio.load();
      activeAudio=null;
    }
    container.replaceChildren(template.content.cloneNode(true));
    currentPerson=id;
    selector.value=id;
    const selected=container.firstElementChild;
    initializePerson(selected);
    document.getElementById("selection-status").textContent=selected.querySelector("h2").textContent + " · " + selected.querySelector(".person-meta").textContent.split(" · Back to people")[0];
    return true;
  }
  selector.addEventListener("change",()=>{
    if(showPerson(selector.value)) history.replaceState(null,"","#"+selector.value);
  });
  function revealHash() {
    let id;
    try { id=decodeURIComponent(location.hash.slice(1)); } catch { return; }
    let target=document.getElementById(id);
    if(!target) {
      const template=templates.get(id) ?? [...templates.values()].find(template=>template.content.getElementById(id));
      if(!template || !showPerson(template.dataset.person)) return;
      target=document.getElementById(id);
    }
    if(!target) return;
    const day=target.closest("[data-day]");if(day) day.open=true;
    target.scrollIntoView({block:"start"});
  }
  addEventListener("hashchange",revealHash);
  if(location.hash) revealHash();
  if(!currentPerson && selector.value) showPerson(selector.value);
})();
