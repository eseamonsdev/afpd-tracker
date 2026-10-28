(() => {
  "use strict";
  const root = document.getElementById("radio-archive");
  if (!root) return;
  const get = (name) => document.getElementById(`radio-${name}`);
  const month = get("month"), day = get("day");
  // Staging experiment: one persistent playback element, without a standby
  // element or preloaded handoff. Keep production behavior during the trial.
  const singlePlayer = typeof window !== "undefined" && (
    /(^|-)afpd-tracker\.ericseamonsdeveloper\.workers\.dev$/.test(window.location.hostname) ||
    /(^|\.)afpd-accountability\.com$/.test(window.location.hostname)
  );
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

  let officerDays = {}, informationNumber = 0, closeInformation = null, activeInformation = null;
  document.addEventListener?.("pointerdown", event => {
    if (activeInformation && !activeInformation.contains(event.target)) closeInformation?.();
  });
  const radioIds = (call) => {
    const ids = [...new Set([
      ...(Array.isArray(call?.radio_ids) ? call.radio_ids : []),
      ...(Array.isArray(call?.srcList) ? call.srcList.map(source => source?.src) : [])
    ].filter(id => typeof id === "string" || typeof id === "number")
      .map(id => String(id).trim()).filter(id => /^[1-9]\d*$/.test(id)))];
    return ids;
  };

  const associationLabels = {
    confirmed: "Confirmed this day",
    strong: "Strong association",
    "single-day": "Single-day association"
  };
  const officerAssociation = (id) => {
    const entry = officerDays[day.value]?.[id];
    return typeof entry?.name === "string" && associationLabels[entry.status] ? entry : null;
  };
  const associationNote = (entry) => {
    const date = dateFormat.format(dateObject(day.value));
    const count = Number(entry.evidence_days) || 1;
    const dates = Array.isArray(entry.evidence_dates) ? entry.evidence_dates.join(", ") : "";
    const description = entry.status === "strong"
      ? `Named exchanges associate this radio ID with ${entry.name} on ${count} dates. An association has not been confirmed for ${date}. Transcript screening found no unresolved contradiction for this ID on that date.`
      : `Named exchanges associate this radio ID with ${entry.name} on ${date}.` +
        (entry.status === "single-day" ? " This is the only supported date; the name is not extended to other dates." : "");
    return `${description}${dates ? ` Evidence dates: ${dates}.` : ""} This does not independently verify the speaker in every clip.`;
  };
  const radioIdText = (call) => {
    const ids = radioIds(call);
    return ids.length ? `Radio ID${ids.length > 1 ? "s" : ""}: ${ids.map(id => {
      const entry = officerAssociation(id);
      return entry ? `${id} · ${entry.name} · ${associationLabels[entry.status]}` : id;
    }).join(", ")}` : "";
  };

  function informationControl(entry) {
    const wrapper = document.createElement("span");
    wrapper.className = "radio-association-info";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "radio-info-button";
    button.textContent = "ⓘ";
    button.setAttribute("aria-label", `Association information for ${entry.name}`);
    button.setAttribute("aria-expanded", "false");
    const popup = document.createElement("span");
    popup.id = `radio-association-info-${++informationNumber}`;
    popup.className = "radio-association-popup";
    popup.setAttribute("role", "note");
    popup.hidden = true;
    button.setAttribute("aria-controls", popup.id);
    button.setAttribute("aria-describedby", popup.id);
    const note = document.createElement("span");
    note.textContent = associationNote(entry);
    const link = document.createElement("a");
    link.href = "/police-radio-resources/#officer-radio-ids";
    link.textContent = "View evidence";
    popup.append(note, link);
    let pinned = false, suppressFocus = false;
    const hide = () => {
      popup.hidden = true;
      pinned = false;
      button.setAttribute("aria-expanded", "false");
    };
    const show = () => {
      if (closeInformation !== hide) closeInformation?.();
      closeInformation = hide;
      activeInformation = wrapper;
      popup.hidden = false;
      button.setAttribute("aria-expanded", "true");
    };
    wrapper.addEventListener("mouseenter", show);
    wrapper.addEventListener("mouseleave", () => {
      if (!pinned && !wrapper.contains(document.activeElement)) hide();
    });
    button.addEventListener("focus", () => { if (!suppressFocus) show(); });
    wrapper.addEventListener("focusout", event => {
      if (!wrapper.contains(event.relatedTarget)) hide();
    });
    button.addEventListener("click", () => {
      if (pinned) hide();
      else { show(); pinned = true; }
    });
    wrapper.addEventListener("keydown", event => {
      if (event.key === "Escape") {
        hide(); suppressFocus = true; button.focus(); suppressFocus = false;
      }
    });
    wrapper.append(button, popup);
    return wrapper;
  }

  function renderRadioIds(element, call) {
    element.replaceChildren();
    const ids = radioIds(call);
    if (!ids.length) return;
    const caption = document.createElement("span");
    caption.className = "radio-id-caption";
    caption.textContent = `Radio ID${ids.length > 1 ? "s" : ""}: `;
    element.append(caption);
    ids.forEach((id, index) => {
      const item = document.createElement("span");
      item.className = "radio-id-association";
      const number = document.createElement("strong");
      number.textContent = id;
      item.append(number);
      const entry = officerAssociation(id);
      if (entry) {
        const officer = document.createElement("span");
        officer.className = "radio-officer-name";
        officer.textContent = ` · ${entry.name}`;
        const status = document.createElement("span");
        status.className = "radio-association-status";
        status.textContent = ` · ${associationLabels[entry.status]}`;
        item.append(officer, status, informationControl(entry));
      }
      element.append(item);
      if (index < ids.length - 1) {
        const separator = document.createElement("span");
        separator.textContent = ", ";
        element.append(separator);
      }
    });
  }

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
    closeInformation?.();
    resetPlayer();
    calls = []; buttons = []; list.replaceChildren();
    section.setAttribute("aria-busy", "true");
    status.textContent = "Loading clips…";
    const entry = days.find((entry) => entry.date === day.value);
    if (!entry) return;
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
      transcriptAvailable = data.enableTranscription === true;
      if (transcriptDownload) {
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
        row.className = "radio-clip-row";
        const button = document.createElement("button");
        button.type = "button"; button.className = "radio-clip";
        const time = document.createElement("time");
        time.dateTime = new Date(call.epoch * 1000).toISOString();
        time.textContent = timeFormat.format(new Date(call.epoch * 1000));
        const label = document.createElement("span");
        const number = document.createElement("span");
        number.className = "radio-clip-number";
        number.textContent = ` · ${index + 1}`;
        label.append(time, number);
        const ids = radioIdText(call);
        let identity;
        if (ids) {
          const radioIds = document.createElement("span");
          radioIds.className = "radio-ids";
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
    clip.style.scrollMarginTop = `${showCurrent.closest(".radio-player").offsetHeight + 32}px`;
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
      const [response, associations] = await Promise.all([
        fetch(`${base}index.json`),
        fetch(`${base}officer-associations.json`).then(response => response.ok ? response.json() : null).catch(() => null)
      ]);
      if (associations?.schema_version === 2 && associations.days && typeof associations.days === "object") {
        officerDays = associations.days;
      }
      if (!response.ok) throw new Error("Unable to load dates");
      const index = await response.json();
      if (!Array.isArray(index.days)) throw new Error("Invalid index");
      days = index.days.filter((entry) => /^\d{4}-\d{2}-\d{2}$/.test(entry.date) && /^[\w.-]+$/.test(entry.folder))
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

