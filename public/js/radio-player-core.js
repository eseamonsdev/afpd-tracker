(() => {
"use strict";
const dateObject = date => new Date(`${date}T12:00:00Z`);
const dateFormat = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", day: "numeric", year: "numeric" });
const timeFormat = new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", hour: "numeric", minute: "2-digit", second: "2-digit" });
const monthFormat = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", year: "numeric" });
const durationText = seconds => { const whole = Math.floor(Number.isFinite(seconds) ? Math.max(0, seconds) : 0); return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`; };
  const radioIds = (call) => {
    const ids = [...new Set([
      ...(Array.isArray(call?.radio_ids) ? call.radio_ids : []),
      ...(Array.isArray(call?.srcList) ? call.srcList.map(source => source?.src) : [])
    ].filter(id => typeof id === "string" || typeof id === "number")
      .map(id => String(id).trim()).filter(id => /^[1-9]\d*$/.test(id)))];
    return ids;
  };

const isDispatchId = id => id.startsWith("904");

function createIdentity(getDate) {
  let afpdIds = new Set(), agencyIds = {};
  let officerDays = {}, strongAssociations = {}, withheldDates = {}, informationNumber = 0, closeInformation = null, activeInformation = null;
  document.addEventListener?.("pointerdown", event => {
    if (activeInformation && !activeInformation.contains(event.target)) closeInformation?.();
  });
  const associationLabels = {
    confirmed: "Confirmed this day",
    strong: "Strong association",
    "single-day": "Single-day association"
  };
  const officerAssociation = (id) => {
    if (isDispatchId(id) || agencyIds[id]) return null;
    const date = getDate();
    const dated = officerDays[date]?.[id];
    if (typeof dated?.name === "string" && associationLabels[dated.status]) return dated;
    if (withheldDates[date]?.includes(id)) return null;
    const entry = strongAssociations[id];
    return typeof entry?.name === "string" && associationLabels[entry.status] ? entry : null;
  };
  const associationNote = (entry) => {
    const date = dateFormat.format(dateObject(getDate()));
    const count = Number(entry.evidence_days) || 1;
    const dates = Array.isArray(entry.evidence_dates) ? entry.evidence_dates.join(", ") : "";
    const description = entry.status === "strong"
      ? `Named exchanges associate this radio ID with ${entry.name} on ${count} dates. An association has not been confirmed for ${date}. The strong association carries from evidence on other dates; it is not a confirmation of the selected date.`
      : `Named exchanges associate this radio ID with ${entry.name} on ${date}.` +
        (entry.status === "single-day" ? " This is the only supported date; the name is not extended to other dates." : "");
    return `${description}${dates ? ` Evidence dates: ${dates}.` : ""} This does not independently verify the speaker in every clip.`;
  };
  const radioIdText = (call) => {
    const ids = radioIds(call);
    return ids.length ? `Radio ID${ids.length > 1 ? "s" : ""}: ${ids.map(id => {
      if (isDispatchId(id)) return `${id} · Dispatch`;
      if (agencyIds[id]) return `${id} · ${agencyIds[id]}`;
      const entry = officerAssociation(id);
      return entry ? `${id} · ${entry.name} · ${associationLabels[entry.status]}` : afpdIds.has(id) ? `${id} · AFPD` : id;
    }).join(", ")}` : "";
  };

  function informationControl(entry, id) {
    const wrapper = document.createElement("span");
    wrapper.className = "radio-association-info";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "radio-info-button";
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", "12"); circle.setAttribute("cy", "12"); circle.setAttribute("r", "9");
    const mark = document.createElementNS("http://www.w3.org/2000/svg", "path");
    mark.setAttribute("d", "M12 11v6M12 7h.01");
    svg.append(circle, mark);
    button.append(svg);
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
    link.href = `/police-radio-resources/#radio-id-${encodeURIComponent(id)}`;
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
      const roleLabel = isDispatchId(id) ? "Dispatch" : agencyIds[id] || (!entry && afpdIds.has(id) ? "AFPD" : "");
      if (roleLabel) {
        const role = document.createElement("span");
        role.className = "radio-role-label";
        role.textContent = ` · ${roleLabel}`;
        item.append(role);
      } else if (entry) {
        const officer = document.createElement("span");
        officer.className = "radio-officer-name";
        officer.textContent = ` · ${entry.name}`;
        const status = document.createElement("span");
        status.className = "radio-association-status";
        status.textContent = ` · ${associationLabels[entry.status]}`;
        item.append(officer, status, informationControl(entry, id));
      }
      element.append(item);
      if (index < ids.length - 1) {
        const separator = document.createElement("span");
        separator.textContent = ", ";
        element.append(separator);
      }
    });
  }


  async function load() {
    try {
      const response = await fetch("/records/openmhz/officer-associations.json");
      const data = response.ok ? await response.json() : null;
      if (data?.schema_version === 2 && data.days && typeof data.days === "object") {
        officerDays = data.days;
        withheldDates = data.withheld_dates ?? {};
        const candidates = new Map(), names = new Map();
        for (const entries of Object.values(officerDays)) {
          for (const [id, entry] of Object.entries(entries)) {
            if (typeof entry?.name !== "string") continue;
            if (!names.has(id)) names.set(id, new Set());
            names.get(id).add(entry.name);
            if (entry.status !== "strong" || Number(entry.evidence_days) < 2) continue;
            const previous = candidates.get(id);
            if (!previous || Number(entry.evidence_days) > Number(previous.evidence_days)) candidates.set(id, entry);
          }
        }
        strongAssociations = Object.fromEntries([...candidates].filter(([id]) => names.get(id).size === 1)
          .map(([id, entry]) => [id, { ...entry, status: "strong" }]));
      }
    } catch { /* Numeric IDs remain available when evidence cannot load. */ }
    try {
      const response = await fetch("/records/openmhz/officer-confirmations.json");
      const data = response.ok ? await response.json() : null;
      if (data?.schema_version === 1 && data.days && typeof data.days === "object") {
        for (const [date, entries] of Object.entries(data.days)) {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !entries || typeof entries !== "object") continue;
          for (const [id, entry] of Object.entries(entries)) {
            if (!/^[1-9]\d*$/.test(id) || entry?.status !== "confirmed" || typeof entry.name !== "string" || !entry.confirmation) continue;
            officerDays[date] ??= {};
            officerDays[date][id] = entry;
          }
        }
      }
    } catch { /* Existing dated associations remain available. */ }
  }
  return { load, render: renderRadioIds, text: radioIdText, close: () => closeInformation?.(),
    setAfpdRadioIds(values, identifiers = {}) {
      agencyIds = Object.fromEntries(Object.entries(identifiers).filter(([id, agency]) => /^[1-9]\d*$/.test(id) && typeof agency === "string" && /^\d+J\d+$/.test(agency)));
      afpdIds = new Set((Array.isArray(values) ? values : [])
        .filter(id => ["string", "number"].includes(typeof id))
        .map(id => String(id).trim()).filter(id => /^[1-9]\d*$/.test(id)));
    }
  };
}

function transcriptUI(get) {
  const toggle = get("transcript-toggle"), panel = get("transcript");
  const status = get("transcript-status"), text = get("transcript-text");
  const note = get("call-note"), noteText = get("call-note-text");
  let on = false, call, available = false;
  function render() {
    if (!panel || !status || !text) return;
    if (toggle) { toggle.hidden = !available; toggle.disabled = !available; }
    panel.hidden = !available || !on;
    const content = typeof call?.transcript === "string" ? call.transcript.trim() : "";
    text.textContent = panel.hidden ? "" : !call ? "Choose a clip to see its transcript." : content || "[no transcript available]";
    status.hidden = panel.hidden || !call || !content;
    status.textContent = status.hidden ? "" : call.validated === true ? "✓ Verified" : "AI-generated · Unverified";
    status.setAttribute("data-verified", String(call?.validated === true));
    if (note && noteText) {
      const content = typeof call?.note === "string" ? call.note.trim() : "";
      note.hidden = panel.hidden || !content;
      noteText.textContent = note.hidden ? "" : content;
    }
    panel.scrollTop = 0;
  }
  toggle?.addEventListener("click", () => {
    if (!available) return;
    on = !on;
    toggle.setAttribute("aria-pressed", String(on));
    toggle.textContent = `Transcript: ${on ? "On" : "Off"}`;
    render();
  });
  return { update(next, enabled) { call = next; available = enabled; render(); } };
}
function bindRow(row, button, choose) {
  button.disabled = false;
  button.addEventListener("click", choose);
  row?.addEventListener("click", event => {
    if (event.target.closest("button, a, .radio-association-info")) return;
    choose();
  });
}
function clipRow(call, index, identity, choose) {
  const row = document.getElementById("radio-clip-row-template").content.firstElementChild.cloneNode(true);
  const button = row.querySelector(".radio-clip");
  const time = row.querySelector("[data-radio-time]");
  time.dateTime = new Date(call.epoch * 1000).toISOString();
  time.textContent = timeFormat.format(new Date(call.epoch * 1000));
  row.querySelector("[data-radio-number]").textContent = ` · ${index + 1}`;
  row.querySelector("[data-radio-duration]").textContent = `${call.displayed_seconds} sec`;
  const ids = identity.text(call);
  button.setAttribute("aria-label", `Play clip ${index + 1}, ${time.textContent}, ${call.displayed_seconds} seconds${ids ? `, ${ids}` : ""}`);
  const line = row.querySelector(".radio-ids");
  line.hidden = !ids;
  identity.render(line, call);
  bindRow(row, button, choose);
  return { row, button };
}

function playbackEngine({ get, getCalls, getButtons, clipSource, label, singlePlayer = true, onSelect, onReset = () => {}, endMessage = "" }) {
  let audio = get("audio"), nextAudio = singlePlayer ? null : document.createElement("audio");
  audio.preload = "auto";
  if (nextAudio) { nextAudio.preload = "auto"; nextAudio.hidden = true; audio.after(nextAudio); }
  const players = nextAudio ? [audio, nextAudio] : [audio];
  const play = get("play"), seek = get("seek"), autoplay = get("autoplay"), showCurrent = get("show-current");
  const current = get("current"), message = get("player-message");
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

  let selected = -1, auto = false, playbackRequest = 0;
  let lastPlayingAudio = null, keepPlaybackPlayer = false;
  let prefetchedClip = null, prefetchController = null, activeObjectUrl = null;
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
    if (!auto || selected < 0 || !getCalls()[selected + 1]) {
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
    if (!auto || selected < 0 || !getCalls()[selected + 1]) {
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
    onReset();
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
    if (!getCalls()[index]) return;
    if (getButtons()[selected]) getButtons()[selected].removeAttribute("aria-current");
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
    const call = getCalls()[index];
    getButtons()[index].setAttribute("aria-current", "true");
    current.textContent = label(index);
    onSelect(call, index);
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

  showCurrent?.addEventListener("click", () => {
    const clip = getButtons()[selected];
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
      if (audio.error) { audio.src = clipSource(selected); clearActiveObjectUrl(); audio.load(); }
      startPlayback();
    } else {
      audio.pause();
    }
  });
  seek.addEventListener("input", () => {
    if (Number.isFinite(audio.duration)) audio.currentTime = Math.min(audio.duration, Math.max(0, Number(seek.value)));
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
      if (!audio.ended) return;
      play.textContent = "Play"; play.setAttribute("aria-label", "Play selected clip");
      if (auto && selected >= 0 && selected + 1 < getCalls().length) {
        chooseClip(selected + 1);
      } else if (selected === getCalls().length - 1 && endMessage) message.textContent = endMessage;
    });
    onActive("error", () => {
      if (selected >= 0 && audio.error) message.textContent = "This clip could not be loaded. Choose another clip or press Play to retry.";
    });
  }


  window.addEventListener?.("pagehide", () => { playbackRequest++; audio.pause(); clearPrefetchedClip(); });
  return { choose: chooseClip, reset: resetPlayer, get selected() { return selected; } };
}
function archive(config) {
  const root = document.getElementById(config.rootId); if (!root) return;
  const get = name => document.getElementById(`${config.prefix}-${name}`);
  const month = get("month"), day = get("day"), reviewProgress = get("review-progress"), transcriptionCount = get("transcription-count"), verificationCount = get("verification-count");

  const list = get("clips"), section = get("clips-section"), status = get("status");
  const currentRadioIds = get("current-radio-ids"), transcriptDownload = get("transcript-download"), transcriptAvailability = get("transcript-availability");
  const base = "/records/openmhz/";
  let days = [], calls = [], buttons = [], folder = "", request = 0, controller, transcriptAvailable = false;
  const identity = createIdentity(() => day.value);
  const transcript = transcriptUI(get);
  function updateRadioIds(call) { if (currentRadioIds) { identity.render(currentRadioIds, call); currentRadioIds.hidden = !radioIds(call).length; } }
  const player = playbackEngine({
    get, getCalls: () => calls, getButtons: () => buttons,
    singlePlayer: config.law2 || /(^|-)afpd-tracker\.ericseamonsdeveloper\.workers\.dev$/.test(window.location.hostname) || /(^|\.)afpd-accountability\.com$/.test(window.location.hostname),
    clipSource: index => `${base}${encodeURIComponent(folder)}/${encodeURIComponent(calls[index].original_filename)}`,
    label: index => `${dateFormat.format(dateObject(day.value))} · ${timeFormat.format(new Date(calls[index].epoch * 1000))} · Clip ${index + 1}`,
    onSelect(call) { identity.close(); updateRadioIds(call); updateTranscript(); },
    onReset() { updateRadioIds(); updateTranscript(); }
  });
  function updateTranscript() { transcript.update(calls[player.selected], transcriptAvailable); }
  function resetPlayer() {
    transcriptAvailable = false;
    if (reviewProgress) reviewProgress.hidden = true;
    if (transcriptionCount) transcriptionCount.textContent = "";
    if (verificationCount) verificationCount.textContent = "";
    if (transcriptDownload) { transcriptDownload.hidden = true; transcriptDownload.removeAttribute("href"); transcriptDownload.removeAttribute("download"); }
    if (transcriptAvailability) transcriptAvailability.hidden = true;
    player.reset();
  }
  async function loadDay() {
    const token = ++request;
    controller?.abort();
    controller = new AbortController();
    identity.close();
    resetPlayer();
    calls = []; buttons = []; list.replaceChildren();
    section.setAttribute("aria-busy", "true");
    status.textContent = "Loading clips…";
    const entry = days.find((entry) => entry.date === day.value);
    if (config.law2 && get("coverage")) get("coverage").hidden = true;
    if (!entry || (config.law2 && entry.enableDay !== true)) { status.textContent = "This date is not enabled."; section.setAttribute("aria-busy", "false"); return; }
    const url = new URL(window.location.href);
    if (url.searchParams.get("date") !== entry.date || url.searchParams.getAll("date").length !== 1) {
      url.searchParams.set("date", entry.date);
      window.history.replaceState(window.history.state, "", url.href);
    }
    folder = entry.folder;
    try {
      const response = await fetch(`${base}${encodeURIComponent(folder)}/calls.json`, { signal: controller.signal, cache: "no-cache" });
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
      // The enabled-date index owns any explicit setting; older indexes fall
      // back to the manifest. Both archives use the same transcript controls.
      const transcriptEnabled = typeof entry.enableTranscription === "boolean"
        ? entry.enableTranscription : data.enableTranscription;
      transcriptAvailable = transcriptEnabled === true && (!config.law2 || calls.some(call => typeof call.transcript === "string" && call.transcript.trim()));
      if (config.law2 && get("coverage")) { get("coverage").textContent = entry.coverageNote || ""; get("coverage").hidden = !entry.coverageNote; }
      if (transcriptDownload && transcriptAvailable) {
        const filename = `${config.law2 ? "law-2" : "afpd-car-to-car"}-transcript-${entry.date}.txt`;
        transcriptDownload.setAttribute("href", `${base}${encodeURIComponent(folder)}/${filename}`);
        transcriptDownload.setAttribute("download", filename);
        transcriptDownload.hidden = false;
      }
      if (transcriptAvailability) transcriptAvailability.hidden = transcriptAvailable;
      updateTranscript();
      const fragment = document.createDocumentFragment();
      buttons = calls.map((call, index) => {
        const { row, button } = clipRow(call, index, identity, () => player.choose(index));
        fragment.append(row); return button;
      });
      list.append(fragment);
      if (reviewProgress && transcriptionCount && verificationCount) {
        const transcribed = calls.filter(call => typeof call.transcript === "string" && call.transcript.trim()).length;
        const verified = calls.filter(call => call.validated === true).length;
        transcriptionCount.textContent = `${transcribed} / ${calls.length}`;
        verificationCount.textContent = `${verified} / ${calls.length}`;
        reviewProgress.hidden = false;
      }
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
  async function initialize() {
    try {
      const [response] = await Promise.all([fetch(`${base}${config.law2 ? "law-2-index.json" : "index.json"}`, { cache: "no-cache" }), identity.load()]);
      if (!response.ok) throw new Error("Unable to load dates");
      const index = await response.json();
      if (!Array.isArray(index.days)) throw new Error("Invalid index");
      if (config.law2) identity.setAfpdRadioIds(index.afpdRadioIds, index.agencyRadioIds);
      days = index.days.filter((entry) => (!config.law2 || (entry.enableDay === true && /^openmhz-afpd-law-2-\d{4}-\d{2}-\d{2}$/.test(entry.folder))) && /^\d{4}-\d{2}-\d{2}$/.test(entry.date) && /^[\w.-]+$/.test(entry.folder))
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
}

function excerpt() {
  const root = document.getElementById("radio-excerpt"); if (!root) return;
  const aliases = { "transcript-toggle": "transcription-toggle", transcript: "transcription" };
  const get = name => root.querySelector(`#excerpt-${aliases[name] || name}`);
  const buttons = Array.from(root.querySelectorAll("[data-excerpt-clip]"));
  const calls = buttons.map(button => ({
    get source() { return button.dataset.source; },
    get displayed_seconds() { return Number(button.dataset.seconds); },
    get transcript() { return button.dataset.transcript || ""; },
    get note() { return button.dataset.note || ""; },
    get validated() { return button.dataset.validated === "true"; },
    get radio_ids() { return (button.dataset.radioIds || "").match(/[1-9]\d*/g) || []; }
  }));
  let associationDate = "";
  const identity = createIdentity(() => associationDate), transcript = transcriptUI(get);
  const dateFor = index => buttons[index]?.dataset.source?.match(/car-to-car-(\d{4}-\d{2}-\d{2})\//)?.[1] || "";
  const updateIdentity = index => {
    const line = get("current-radio-ids"); if (!line) return;
    associationDate = dateFor(index); identity.render(line, calls[index]); line.hidden = !radioIds(calls[index]).length;
  };
  const player = playbackEngine({ get, getCalls: () => calls, getButtons: () => buttons,
    clipSource: index => calls[index].source, label: index => buttons[index].dataset.label,
    endMessage: "End of excerpt.",
    onSelect(call, index) { identity.close(); updateIdentity(index); transcript.update(call, Boolean(get("transcript-toggle"))); }
  });
  transcript.update(undefined, Boolean(get("transcript-toggle")));
  buttons.forEach((button, index) => {
    const row = button.closest?.("li");
    row?.classList.add("radio-clip-row");

    bindRow(row, button, () => player.choose(index));
  });
  identity.load().then(() => {
    buttons.forEach((button, index) => {
      const row = button.closest?.("li");
      const line = row?.querySelector(".radio-ids");
      associationDate = dateFor(index);
      if (line) identity.render(line, calls[index]);
      const label = button.getAttribute("aria-label") || "";
      button.setAttribute("aria-label", label.replace(/, Radio IDs?:.*$/, "") + (identity.text(calls[index]) ? `, ${identity.text(calls[index])}` : ""));
    });
    if (player.selected >= 0) updateIdentity(player.selected);
  });
  const download = get("transcript-download"); let downloadUrl;
  if (download) {
    download.hidden = false; download.setAttribute("href", "#");
    download.setAttribute("download", "afpd-car-to-car-transcript-" + window.location.pathname.split("/").filter(Boolean).at(-1) + ".txt");
    download.addEventListener("click", () => {
      if (downloadUrl) URL.revokeObjectURL(downloadUrl);
      const text = buttons.map((button, index) => [button.dataset.label, button.dataset.radioIds || "", calls[index].transcript.trim() || "[no transcript available]", calls[index].note.trim() ? `Note: ${calls[index].note.trim()}` : ""].filter(Boolean).join("\n")).join("\n\n") + "\n";
      downloadUrl = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" })); download.setAttribute("href", downloadUrl);
    });
  }
}
globalThis.RadioPlayer = { archive, excerpt, bindRow };
})();

