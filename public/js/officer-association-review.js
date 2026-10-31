(() => {
  "use strict";
  const players = [...document.querySelectorAll("[data-day]")];
  for (const day of players) {
    const audio = day.querySelector("audio"), clips = [...day.querySelectorAll("button[data-source]")];
    const previous = day.querySelector('[data-action="previous"]'), next = day.querySelector('[data-action="next"]');
    const current = day.querySelector(".current"), message = day.querySelector(".message"), recording = day.querySelector(".recording");
    const transcript = day.querySelector(".transcript"), toggle = day.querySelector('[data-action="transcript"]');
    const speed = day.querySelector("[data-speed]");
    let index = -1, generation = 0;
    function select(number, play = true) {
      if (!Number.isInteger(number) || number < 0 || number >= clips.length) return;
      const clip = clips[number], selected = ++generation;
      if (index !== number) {
        audio.pause(); index = number; audio.src = clip.dataset.source;
      }
      audio.playbackRate = Number(speed.value);
      clips.forEach((button, n) => { button.classList.toggle("is-current",n===index); if (n===index) button.setAttribute("aria-current","true"); else button.removeAttribute("aria-current"); });
      current.textContent = `${clip.children[0].textContent.trim()} · Radio ${clip.children[1].textContent.trim()}`; previous.disabled = index===0; next.disabled = index===clips.length-1;
      day.querySelector(".transcript-text").textContent = clip.dataset.transcript.trim() || "No transcript available.";
      day.querySelector(".transcript-status").textContent = clip.dataset.transcript.trim() ? clip.dataset.verified === "true" ? "Verified transcript" : "AI transcript · unverified" : "";
      day.querySelector(".call-note").textContent = clip.dataset.note;
      recording.href = clip.dataset.source; recording.hidden = false; message.textContent = "";
      if (play) audio.play().catch(() => { if (selected !== generation) return; message.textContent = "Playback did not start. Use the audio Play control or open the selected recording."; });
    }
    clips.forEach((clip, n) => clip.addEventListener("click", () => select(n)));
    day.querySelector('[data-action="play-day"]').addEventListener("click", () => select(0));
    previous.addEventListener("click", () => select(index-1)); next.addEventListener("click", () => select(index+1));
    speed.addEventListener("change", () => { audio.playbackRate = Number(speed.value); });
    audio.addEventListener("play", () => { players.forEach(other => { const player=other.querySelector("audio"); if(player!==audio) player.pause(); }); });
    audio.addEventListener("ended", () => { if(day.querySelector("[data-autoplay]").checked && index+1<clips.length) select(index+1); });
    audio.addEventListener("error", () => { message.textContent = "This recording could not be loaded. Try the selected recording link or the full archive day."; });
    toggle.addEventListener("click", () => { transcript.hidden=!transcript.hidden; toggle.textContent=transcript.hidden ? "Transcript: Off" : "Transcript: On"; toggle.setAttribute("aria-pressed", String(!transcript.hidden)); });
  }
  const search=document.getElementById("person-search"), sections=[...document.querySelectorAll(".person")];
  const navigation=[...document.querySelectorAll("#people a")];
  function filter() {
    const value=search.value.trim().toLowerCase();
    sections.forEach(section => { section.hidden=!section.dataset.search.includes(value); });
    navigation.forEach((link,i) => { link.hidden=sections[i].hidden; });
    document.getElementById("search-status").textContent=`${sections.filter(s=>!s.hidden).length} ${sections.filter(s=>!s.hidden).length === 1 ? "person" : "people"} shown`;
  }
  search.addEventListener("input",filter);
  function revealHash() {
    const target=document.getElementById(decodeURIComponent(location.hash.slice(1)));
    if (!target) return;
    const person=target.closest(".person");
    if (person?.hidden) { search.value="";filter(); }
    const day=target.closest("[data-day]");if(day) day.open=true;
    target.scrollIntoView({block:"start"});
  }
  addEventListener("hashchange",revealHash); filter(); if(location.hash) revealHash();
})();
