// Independent Law 2 player; changes here do not alter the car-to-car player.
(() => {
  "use strict";
  const root = document.getElementById("law2-radio-archive");
  if (!root) return;
  const get = (name) => document.getElementById(`law2-radio-${name}`);
  const month = get("month"), day = get("day");
  // Keep one playback element for mobile Safari.
  const singlePlayer = true;
  let audio = get("audio"), nextAudio = singlePlayer ? null : document.createElement("audio");
  audio.preload = "auto";
  if (nextAudio) {
    nextAudio.preload = "auto";
    nextAudio.hidden = true;
    audio.after(nextAudio);
  }
  const players = nextAudio ? [audio, nextAudio] : [audio];
  const play = get("play"), seek = get("seek"), autoplay = get("autoplay");
  const showCurrent = get("show-current");
  const controlsToggle = get("controls-toggle"), extraControls = get("extra-controls");
  if (controlsToggle && extraControls) {
    controlsToggle.hidden = false;
    controlsToggle.addEventListener("click", () => {
      const expanded = controlsToggle.getAttribute("aria-expanded") !== "true";
      extraControls.hidden = !expanded;
      controlsToggle.setAttribute("aria-expanded", String(expanded));
      controlsToggle.textContent = expanded ? "Hide Controls" : "Show Controls";
    });
  }
  const list = get("clips"), section = get("clips-section"), status = get("status");
  const current = get("current"), message = get("player-message");
  const currentRadioIds = get("current-radio-ids");
  const transcriptToggle = get("transcript-toggle"), transcript = get("transcript");
  const transcriptDownload = get("transcript-download");
  const transcriptStatus = get("transcript-status"), transcriptText = get("transcript-text");
  const callNote = get("call-note"), callNoteText = get("call-note-text");
  const transcriptAvailability = get("transcript-availability");
  let transcriptOn = false;
  let transcriptAvailable = false;
  const base = "/records/openmhz/";
  const timeFormat = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Denver", hour: "numeric", minute: "2-digit", second: "2-digit"
  });
  const dateFormat = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC", month: "long", day: "numeric", year: "numeric"
  });
  const monthFormat = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", year: "numeric" });
  const dateObject = (date) => new Date(`${date}T12:00:00Z`);
  const durationText = (seconds) => {
    const whole = Math.floor(Number.isFinite(seconds) ? seconds : 0);
    return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
  };
  let days = [], calls = [], buttons = [], selected = -1, folder = "";
  let auto = false, request = 0, playbackRequest = 0, controller;
  let lastPlayingAudio = null, keepPlaybackPlayer = false;
  let prefetchedClip = null, prefetchController = null, activeObjectUrl = null;

  // Law 2 identities remain numeric; car-to-car name associations are not inherited.
  const radioIds = (call) => [...new Set([
    ...(Array.isArray(call?.radio_ids) ? call.radio_ids : []),
    ...(Array.isArray(call?.srcList) ? call.srcList.map(source => source?.src) : [])
  ].filter(id => typeof id === "string" || typeof id === "number")
    .map(id => String(id).trim()).filter(id => /^[1-9]\d*$/.test(id)))];
  const radioIdText = (call) => {
    const ids = radioIds(call);
    return ids.length ? `Radio ID${ids.length > 1 ? "s" : ""}: ${ids.join(", ")}` : "";
  };
  function renderRadioIds(element, call) { element.textContent = radioIdText(call); }
  function updateRadioIds(call) {
    if (!currentRadioIds) return;
    renderRadioIds(currentRadioIds, call);
    currentRadioIds.hidden = !radioIds(call).length;
  }

  const clipSource = (index) => `${base}${encodeURIComponent(folder)}/${encodeURIComponent(calls[index].original_filename)}`;

  function updateTranscript() {
    if (!transcript || !transcriptStatus || !transcriptText) return;
    if (transcriptToggle) {
      transcriptToggle.hidden = !transcriptAvailable;
      transcriptToggle.disabled = !transcriptAvailable;
    }
    const call = calls[selected];
    const text = typeof call?.transcript === "string" ? call.transcript.trim() : "";
    transcript.hidden = !transcriptAvailable || !transcriptOn;
    transcriptText.textContent = transcript.hidden ? "" : !call
      ? "Choose a clip to see its transcript."
      : text || "[no transcript available]";
    transcriptStatus.hidden = transcript.hidden || !call || !text;
    transcriptStatus.textContent = transcriptStatus.hidden ? ""
      : call.validated === true ? "✓ Verified" : "AI-generated · Unverified";
    transcriptStatus.setAttribute("data-verified", String(call?.validated === true));
    if (callNote && callNoteText) {
      const note = typeof call?.note === "string" ? call.note.trim() : "";
      callNote.hidden = transcript.hidden || !note;
      callNoteText.textContent = callNote.hidden ? "" : note;
    }
    transcript.scrollTop = 0;
  }

  if (transcriptToggle) {
    transcriptToggle.addEventListener("click", () => {
      if (!transcriptAvailable) return;
      transcriptOn = !transcriptOn;
      transcriptToggle.setAttribute("aria-pressed", String(transcriptOn));
      transcriptToggle.textContent = `Transcript: ${transcriptOn ? "On" : "Off"}`;
      updateTranscript();
    });
    updateTranscript();
  }

  function clearAudio(player) {
    if (!player) return;
    player.pause();
    if (player.hasAttribute("src")) {
      player.removeAttribute("src");
      player.load();
    }
  }

  function clearPrefetchedClip() {
    prefetchController?.abort();
    prefetchController = null;
    if (prefetchedClip?.url) URL.revokeObjectURL(prefetchedClip.url);
    prefetchedClip = null;
  }

  function clearActiveObjectUrl() {
    if (activeObjectUrl) URL.revokeObjectURL(activeObjectUrl);
    activeObjectUrl = null;
  }

  async function prefetchNextClip() {
    if (!auto || selected < 0 || !calls[selected + 1]) {
      clearPrefetchedClip();
      return;
    }
    const index = selected + 1;
    const source = clipSource(index);
    if (prefetchedClip?.source === source) return;
    clearPrefetchedClip();
    const prefetch = new AbortController();
    const entry = { index, source, url: null };
    prefetchController = prefetch;
    prefetchedClip = entry;
    try {
      const response = await fetch(source, { signal: prefetch.signal });
      if (!response.ok) throw new Error("Unable to preload clip");
      const blob = await response.blob();
      if (prefetch.signal.aborted || prefetchedClip !== entry || !auto || selected + 1 !== index || clipSource(index) !== source) return;
      entry.url = URL.createObjectURL(blob);
      prefetchController = null;
    } catch (error) {
      if (prefetchedClip === entry) prefetchedClip = null;
      if (prefetchController === prefetch) prefetchController = null;
    }
  }

  function prepareNextClip() {
    if (singlePlayer) {
      prefetchNextClip();
      return;
    }
    if (!auto || selected < 0 || !calls[selected + 1]) {
      clearAudio(nextAudio);
      return;
    }
    const source = clipSource(selected + 1);
    if (nextAudio.getAttribute("src") === source) return;
    clearAudio(nextAudio);
    nextAudio.src = source;
    nextAudio.load();
  }

  function updateDuration() {
    if (selected < 0 || !Number.isFinite(audio.duration)) return;
    seek.max = audio.duration;
    seek.disabled = false;
    get("duration").textContent = durationText(audio.duration);
  }

  function resetPlayer() {
    transcriptAvailable = false;
    if (transcriptDownload) {
      transcriptDownload.hidden = true;
      transcriptDownload.removeAttribute("href");
      transcriptDownload.removeAttribute("download");
    }
    if (transcriptAvailability) transcriptAvailability.hidden = true;
    clearPrefetchedClip();
    clearActiveObjectUrl();
    selected = -1;
    playbackRequest++;
    players.forEach(clearAudio);
    play.disabled = true;
    if (showCurrent) showCurrent.disabled = true;
    seek.disabled = true;
    seek.value = 0;
    seek.max = 0;
    play.textContent = "Play";
    play.setAttribute("aria-label", "Play selected clip");
    get("elapsed").textContent = "0:00";
    get("duration").textContent = "0:00";
    current.textContent = "Choose a clip to listen";
    updateRadioIds();
    updateTranscript();
    message.textContent = "";
  }

  async function startPlayback() {
    const player = audio, source = player.getAttribute("src"), token = playbackRequest;
    try {
      await player.play();
    } catch (error) {
      if (token !== playbackRequest || player !== audio || source !== player.getAttribute("src") || error.name === "AbortError") return;
      // Safari grants playback permission per media element. If it rejects a
      // preloaded handoff, continue on the element that already played audio.
      if (error.name === "NotAllowedError" && lastPlayingAudio && player !== lastPlayingAudio) {
        keepPlaybackPlayer = true;
        const fallback = lastPlayingAudio;
        nextAudio = player;
        audio = fallback;
        playbackRequest++;
        clearAudio(nextAudio);
        audio.src = source;
        audio.load();
        updateDuration();
        startPlayback();
        return;
      }
      message.textContent = "Playback could not start. Press Play to try again or choose another clip.";
    }
  }

  function chooseClip(index) {
    if (!calls[index]) return;
    if (buttons[selected]) buttons[selected].removeAttribute("aria-current");
    playbackRequest++;
    audio.pause();
    const source = clipSource(index);
    const prefetched = singlePlayer && prefetchedClip?.source === source && prefetchedClip.url ? prefetchedClip : null;
    const prepared = Boolean(prefetched) || (!singlePlayer && !keepPlaybackPlayer && nextAudio.getAttribute("src") === source && !nextAudio.error);
    if (prepared && !singlePlayer) [audio, nextAudio] = [nextAudio, audio];
    clearAudio(nextAudio);
    if (prefetched) {
      prefetchedClip = null;
      prefetchController = null;
    } else {
      clearPrefetchedClip();
    }
    clearActiveObjectUrl();
    selected = index;
    const call = calls[index];
    buttons[index].setAttribute("aria-current", "true");
    current.textContent = `${dateFormat.format(dateObject(day.value))} · ${timeFormat.format(new Date(call.epoch * 1000))} · Clip ${index + 1}`;
    updateRadioIds(call);
    updateTranscript();
    message.textContent = "";
    seek.disabled = true;
    seek.max = 0;
    seek.value = 0;
    get("elapsed").textContent = "0:00";
    get("duration").textContent = durationText(call.displayed_seconds);
    play.disabled = false;
    if (showCurrent) showCurrent.disabled = false;
    if (prefetched) {
      audio.src = prefetched.url;
      activeObjectUrl = prefetched.url;
      audio.load();
    } else if (!prepared) {
      audio.src = source;
      audio.load();
    }
    // A preloaded player may have fired loadedmetadata while it was inactive.
    updateDuration();
    startPlayback();
  }

  async function loadDay() {
    const token = ++request;
    controller?.abort();
    controller = new AbortController();
    resetPlayer();
    calls = []; buttons = []; list.replaceChildren();
    section.setAttribute("aria-busy", "true");
    status.textContent = "Loading clips…";
    const entry = days.find((entry) => entry.date === day.value);
    get("coverage").hidden = true;
    if (!entry || entry.enableDay !== true) {
      status.textContent = "This date is not enabled.";
      section.setAttribute("aria-busy", "false");
      return;
    }
    const url = new URL(window.location.href);
    if (url.searchParams.get("date") !== entry.date || url.searchParams.getAll("date").length !== 1) {
      url.searchParams.set("date", entry.date);
      window.history.replaceState(window.history.state, "", url.href);
    }
    folder = entry.folder;
    try {
      const response = await fetch(`${base}${encodeURIComponent(folder)}/calls.json`, { signal: controller.signal });
      if (!response.ok) throw new Error("Unable to load clips");
      const data = await response.json();
      if (token !== request) return;
      if (!Array.isArray(data.calls) || data.date !== entry.date) throw new Error("Invalid manifest");
      calls = data.calls.map((call) => {
        if (!Number.isFinite(call.epoch) || !/^[\w.-]+\.m4a$/.test(call.original_filename)) {
          throw new Error("Invalid clip");
        }
        return call;
      }).sort((a, b) => a.epoch - b.epoch);
      transcriptAvailable = entry.enableTranscription === true && calls.some(call => typeof call.transcript === "string" && call.transcript.trim());
      get("coverage").textContent = entry.coverageNote || "";
      get("coverage").hidden = !entry.coverageNote;
      if (transcriptDownload && transcriptAvailable) {
        const filename = `transcript_${entry.date.replaceAll("-", "_")}.txt`;
        transcriptDownload.setAttribute("href", `${base}${encodeURIComponent(folder)}/${filename}`);
        transcriptDownload.setAttribute("download", filename);
        transcriptDownload.hidden = false;
      }
      if (transcriptAvailability) transcriptAvailability.hidden = transcriptAvailable;
      updateTranscript();
      const fragment = document.createDocumentFragment();
      buttons = calls.map((call, index) => {
        const row = document.createElement("li");
        row.className = "law2-radio-clip-row";
        const button = document.createElement("button");
        button.type = "button"; button.className = "law2-radio-clip";
        const time = document.createElement("time");
        time.dateTime = new Date(call.epoch * 1000).toISOString();
        time.textContent = timeFormat.format(new Date(call.epoch * 1000));
        const label = document.createElement("span");
        const number = document.createElement("span");
        number.className = "law2-radio-clip-number";
        number.textContent = ` · ${index + 1}`;
        label.append(time, number);
        const ids = radioIdText(call);
        let identity;
        if (ids) {
          const radioIds = document.createElement("span");
          radioIds.className = "law2-radio-ids";
          renderRadioIds(radioIds, call);
          identity = radioIds;
        }
        const duration = document.createElement("span");
        duration.textContent = `${call.displayed_seconds} sec`;
        button.setAttribute("aria-label", `Play clip ${index + 1}, ${time.textContent}, ${call.displayed_seconds} seconds${ids ? `, ${ids}` : ""}`);
        button.append(label, duration);
        button.addEventListener("click", () => {
          chooseClip(index);
        });
        row.addEventListener("click", event => {
          if (event.target.closest("button, a, .law2-radio-association-info")) return;
          chooseClip(index);
        });
        row.append(button);
        if (identity) row.append(identity);
        fragment.append(row);
        return button;
      });
      list.append(fragment);
      status.textContent = calls.length ? `${dateFormat.format(dateObject(entry.date))} · ${calls.length} clips` : "No clips available for this day.";
    } catch (error) {
      if (token !== request || error.name === "AbortError") return;
      calls = []; buttons = []; list.replaceChildren();
      status.textContent = "Unable to load this day. Select another day or reload the page to try again.";
    } finally {
      if (token === request) section.setAttribute("aria-busy", "false");
    }
  }

  function populateDays(selectedDate = "") {
    day.replaceChildren();
    for (const entry of days.filter((entry) => entry.date.startsWith(month.value))) {
      day.add(new Option(`${dateFormat.format(dateObject(entry.date))} — ${entry.count} clips`, entry.date));
    }
    if (selectedDate) day.value = selectedDate;
    day.disabled = !day.options.length;
    loadDay();
  }
  month.addEventListener("change", () => populateDays());
  day.addEventListener("change", loadDay);
  showCurrent?.addEventListener("click", () => {
    const clip = buttons[selected];
    if (!clip) return;
    // Center in the space below the sticky player, leaving a little clearance.
    clip.style.scrollMarginTop = `${showCurrent.closest(".law2-radio-player").offsetHeight + 32}px`;
    clip.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
      block: "center",
      inline: "nearest"
    });
  });
  autoplay.addEventListener("click", () => {
    auto = !auto;
    autoplay.setAttribute("aria-pressed", String(auto));
    autoplay.textContent = `Autoplay: ${auto ? "On" : "Off"}`;
    if (!auto || !audio.paused) prepareNextClip();
  });
  play.addEventListener("click", () => {
    if (selected < 0) return;
    message.textContent = "";
    if (audio.paused) {
      if (audio.error) audio.load();
      startPlayback();
    } else {
      audio.pause();
    }
  });
  seek.addEventListener("input", () => {
    if (Number.isFinite(audio.duration)) audio.currentTime = Number(seek.value);
  });
  for (const player of players) {
    const onActive = (event, handler) => player.addEventListener(event, () => {
      if (player === audio) handler();
    });
    onActive("loadedmetadata", updateDuration);
    // Start preloading after current playback begins so it gets network priority.
    onActive("playing", () => {
      lastPlayingAudio = player;
      prepareNextClip();
    });
    onActive("timeupdate", () => {
      seek.value = audio.currentTime;
      get("elapsed").textContent = durationText(audio.currentTime);
      seek.setAttribute("aria-valuetext", `${durationText(audio.currentTime)} of ${durationText(audio.duration)}`);
    });
    onActive("play", () => {
      if (audio.paused) return;
      play.textContent = "Pause"; play.setAttribute("aria-label", "Pause selected clip");
    });
    onActive("pause", () => {
      if (!audio.paused) return;
      play.textContent = "Play"; play.setAttribute("aria-label", "Play selected clip");
    });
    onActive("ended", () => {
      if (audio.ended && auto && selected >= 0 && selected + 1 < calls.length) {
        chooseClip(selected + 1);
      }
    });
    onActive("error", () => {
      if (selected >= 0 && audio.error) message.textContent = "This clip could not be loaded. Choose another clip or press Play to retry.";
    });
  }

  async function initialize() {
    try {
      const response = await fetch(`${base}law-2-index.json`);
      if (!response.ok) throw new Error("Unable to load dates");
      const index = await response.json();
      if (!Array.isArray(index.days)) throw new Error("Invalid index");
      days = index.days.filter((entry) => entry.enableDay === true && /^\d{4}-\d{2}-\d{2}$/.test(entry.date) && /^openmhz-afpd-law-2-\d{4}-\d{2}-\d{2}$/.test(entry.folder))
        .sort((a, b) => b.date.localeCompare(a.date));
      month.replaceChildren(); day.replaceChildren();
      if (!days.length) {
        month.add(new Option("No months available", ""));
        day.add(new Option("No days available", ""));
        status.textContent = "No recordings are available yet.";
        section.setAttribute("aria-busy", "false");
        return;
      }
      for (const value of new Set(days.map((entry) => entry.date.slice(0, 7)))) {
        month.add(new Option(monthFormat.format(dateObject(`${value}-01`)), value));
      }
      const requestedDate = new URL(window.location.href).searchParams.get("date");
      const initialDay = days.find((entry) => entry.date === requestedDate) ?? days[0];
      month.value = initialDay.date.slice(0, 7);
      month.disabled = false;
      populateDays(initialDay.date);
    } catch (error) {
      month.replaceChildren(new Option("Unavailable", ""));
      day.replaceChildren(new Option("Unavailable", ""));
      status.textContent = "Unable to load available dates. Reload the page to try again.";
      section.setAttribute("aria-busy", "false");
    }
  }
  initialize();
})();

