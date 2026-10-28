(() => {
  "use strict";
  const root = document.getElementById("radio-excerpt");
  if (!root) return;
  const get = name => root.querySelector(`#excerpt-${name}`);
  const audio = get("audio"), play = get("play"), seek = get("seek");
  const autoplay = get("autoplay"), showCurrent = get("show-current");
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
  const message = get("player-message"), current = get("current");
  const currentRadioIds = get("current-radio-ids");
  const transcriptionToggle = get("transcription-toggle"), transcription = get("transcription");
  const transcriptStatus = get("transcript-status"), transcriptText = get("transcript-text");
  const callNote = get("call-note"), callNoteText = get("call-note-text");
  let transcriptionOn = false;
  const buttons = Array.from(root.querySelectorAll("[data-excerpt-clip]"));
  let associationDate = "", associationsReady = false;
  const dateFormat = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", day: "numeric", year: "numeric" });
  const dateObject = date => new Date(`${date}T12:00:00Z`);
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
    const entry = officerDays[associationDate]?.[id];
    return typeof entry?.name === "string" && associationLabels[entry.status] ? entry : null;
  };
  const associationNote = (entry) => {
    const date = dateFormat.format(dateObject(associationDate));
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

  function informationControl(entry, id) {
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
      if (entry) {
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


  const callFor = button => ({
    radio_ids: (button?.dataset.radioIds || "").match(/[1-9]\d*/g) || []
  });
  const dateFor = button => button?.dataset.source?.match(/car-to-car-(\d{4}-\d{2}-\d{2})\//)?.[1] || "";
  function updateIdentity(button) {
    if (!currentRadioIds) return;
    if (associationsReady) {
      associationDate = dateFor(button);
      renderRadioIds(currentRadioIds, callFor(button));
    } else currentRadioIds.textContent = button?.dataset.radioIds || "";
    currentRadioIds.hidden = !button?.dataset.radioIds;
  }
  fetch("/records/openmhz/officer-associations.json")
    .then(response => response.ok ? response.json() : null)
    .then(data => {
      if (data?.schema_version !== 2 || !data.days || typeof data.days !== "object") return;
      officerDays = data.days;
      associationsReady = true;
      buttons.forEach(button => {
        const identity = button.querySelector(".radio-ids");
        if (!identity) return;
        // Information buttons sit beside the playback button, as in the archive.
        const row = button.closest("li");
        row.classList.add("radio-clip-row");
        row.append(identity);
        associationDate = dateFor(button);
        const call = callFor(button);
        renderRadioIds(identity, call);
        const label = button.getAttribute("aria-label");
        button.setAttribute("aria-label", label.replace(/, Radio IDs?:.*$/, "") + (radioIdText(call) ? `, ${radioIdText(call)}` : ""));
      });
      updateIdentity(buttons[selected]);
    }).catch(() => {});
  const transcriptDownload = get("transcript-download");
  let transcriptDownloadUrl = null;
  if (transcriptDownload) {
    transcriptDownload.hidden = false;
    transcriptDownload.setAttribute("href", "#");
    transcriptDownload.setAttribute("download", "transcript_" + window.location.pathname.split("/").filter(Boolean).at(-1) + ".txt");
    transcriptDownload.addEventListener("click", () => {
      if (transcriptDownloadUrl) URL.revokeObjectURL(transcriptDownloadUrl);
      const text = buttons.map(button => [
        button.dataset.label,
        button.dataset.radioIds || "",
        button.dataset.transcript?.trim() || "[no transcript available]",
        button.dataset.note?.trim() ? `Note: ${button.dataset.note.trim()}` : ""
      ].filter(Boolean).join("\n")).join("\n\n") + "\n";
      transcriptDownloadUrl = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
      transcriptDownload.setAttribute("href", transcriptDownloadUrl);
    });
  }
  // A single persistent element preserves Safari's user-granted playback permission.
  audio.preload = "auto";
  let selected = -1, auto = false, playbackRequest = 0;
  let prefetched = null, prefetchController = null, activeObjectUrl = null;
  function updateTranscription() {
    if (!transcriptionToggle || !transcription || !transcriptText) return;
    transcription.hidden = !transcriptionOn;
    const button = buttons[selected];
    const text = button?.dataset.transcript?.trim() || "";
    transcriptText.textContent = !transcriptionOn ? "" : selected < 0
      ? "Choose a clip to see its transcript."
      : text || "[no transcript available]";
    if (transcriptStatus) {
      transcriptStatus.hidden = !transcriptionOn || !button || !text;
      transcriptStatus.textContent = transcriptStatus.hidden ? ""
        : button.dataset.validated === "true" ? "✓ Verified" : "AI-generated · Unverified";
      transcriptStatus.setAttribute("data-verified", String(button?.dataset.validated === "true"));
    }
    if (callNote && callNoteText) {
      const note = button?.dataset.note?.trim() || "";
      callNote.hidden = !transcriptionOn || !note;
      callNoteText.textContent = callNote.hidden ? "" : note;
    }
    transcription.scrollTop = 0;
  }
  if (transcriptionToggle && transcription) {
    transcriptionToggle.disabled = false;
    transcriptionToggle.addEventListener("click", () => {
      transcriptionOn = !transcriptionOn;
      transcriptionToggle.setAttribute("aria-pressed", String(transcriptionOn));
      transcriptionToggle.textContent = `Transcript: ${transcriptionOn ? "On" : "Off"}`;
      updateTranscription();
    });
    updateTranscription();
  }
  const durationText = seconds => {
    const whole = Math.floor(Number.isFinite(seconds) ? Math.max(0, seconds) : 0);
    return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
  };
  function clearPrefetch() {
    prefetchController?.abort();
    prefetchController = null;
    if (prefetched?.url) URL.revokeObjectURL(prefetched.url);
    prefetched = null;
  }
  async function prepareNext() {
    const next = buttons[selected + 1];
    if (!auto || selected < 0 || !next) { clearPrefetch(); return; }
    const source = next.dataset.source;
    if (prefetched?.source === source) return;
    clearPrefetch();
    const controller = new AbortController();
    const entry = { source, url: null };
    prefetchController = controller; prefetched = entry;
    try {
      const response = await fetch(source, { signal: controller.signal });
      if (!response.ok) throw new Error("Preload failed");
      const blob = await response.blob();
      if (controller.signal.aborted || prefetched !== entry || !auto) return;
      entry.url = URL.createObjectURL(blob);
      prefetchController = null;
    } catch {
      if (prefetched === entry) prefetched = null;
      if (prefetchController === controller) prefetchController = null;
    }
  }
  function updateDuration() {
    if (selected < 0 || !Number.isFinite(audio.duration)) return;
    seek.max = audio.duration; seek.disabled = false;
    get("duration").textContent = durationText(audio.duration);
  }
  async function startPlayback() {
    const token = playbackRequest;
    try { await audio.play(); }
    catch (error) {
      if (token !== playbackRequest || error.name === "AbortError") return;
      message.textContent = "Playback could not start. Press Play to try again or choose another clip.";
    }
  }
  function chooseClip(index) {
    const button = buttons[index];
    if (!button) return;
    buttons[selected]?.removeAttribute("aria-current");
    playbackRequest++;
    audio.pause();
    const source = button.dataset.source;
    const ready = prefetched?.source === source && prefetched.url ? prefetched.url : null;
    if (ready) { prefetched = null; prefetchController = null; }
    else clearPrefetch();
    const oldUrl = activeObjectUrl;
    selected = index; activeObjectUrl = ready;
    button.setAttribute("aria-current", "true");
    current.textContent = button.dataset.label;
    closeInformation?.();
    updateIdentity(button);
    updateTranscription();
    message.textContent = "";
    seek.disabled = true; seek.max = 0; seek.value = 0;
    seek.setAttribute("aria-valuetext", "0:00");
    get("elapsed").textContent = "0:00";
    get("duration").textContent = durationText(Number(button.dataset.seconds));
    play.disabled = false; showCurrent.disabled = false;
    audio.src = ready || source;
    audio.load();
    if (oldUrl) URL.revokeObjectURL(oldUrl);
    startPlayback();
  }
  buttons.forEach((button, index) => {
    button.disabled = false;
    button.addEventListener("click", () => chooseClip(index));
  });
  showCurrent.addEventListener("click", () => {
    const clip = buttons[selected];
    if (!clip) return;
    clip.style.scrollMarginTop = `${root.querySelector(".radio-player").offsetHeight + 32}px`;
    clip.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "center", inline: "nearest" });
  });
  autoplay.addEventListener("click", () => {
    auto = !auto;
    autoplay.setAttribute("aria-pressed", String(auto));
    autoplay.textContent = `Autoplay: ${auto ? "On" : "Off"}`;
    if (!auto || !audio.paused) prepareNext();
  });
  play.addEventListener("click", () => {
    if (selected < 0) return;
    message.textContent = "";
    if (audio.paused) {
      if (audio.error) {
        // Retry the original URL if a prefetched Blob failed to decode.
        audio.src = buttons[selected].dataset.source;
        audio.load();
        if (activeObjectUrl) URL.revokeObjectURL(activeObjectUrl);
        activeObjectUrl = null;
      }
      startPlayback();
    } else { playbackRequest++; audio.pause(); }
  });
  seek.addEventListener("input", () => {
    if (Number.isFinite(audio.duration)) audio.currentTime = Math.min(audio.duration, Math.max(0, Number(seek.value)));
  });
  audio.addEventListener("loadedmetadata", updateDuration);
  audio.addEventListener("playing", prepareNext);
  audio.addEventListener("timeupdate", () => {
    seek.value = audio.currentTime;
    get("elapsed").textContent = durationText(audio.currentTime);
    seek.setAttribute("aria-valuetext", `${durationText(audio.currentTime)} of ${durationText(audio.duration)}`);
  });
  audio.addEventListener("play", () => {
    if (audio.paused) return;
    play.textContent = "Pause"; play.setAttribute("aria-label", "Pause selected clip");
  });
  audio.addEventListener("pause", () => {
    if (!audio.paused) return;
    play.textContent = "Play"; play.setAttribute("aria-label", "Play selected clip");
  });
  audio.addEventListener("ended", () => {
    if (!audio.ended) return;
    play.textContent = "Play"; play.setAttribute("aria-label", "Play selected clip");
    if (auto && selected + 1 < buttons.length) chooseClip(selected + 1);
    else if (selected === buttons.length - 1) message.textContent = "End of excerpt.";
  });
  audio.addEventListener("error", () => {
    if (selected >= 0 && audio.error) message.textContent = "This clip could not be loaded. Choose another clip or press Play to retry.";
  });
  window.addEventListener("pagehide", () => {
    playbackRequest++; audio.pause(); clearPrefetch();
    // The active Blob stays valid for back/forward-cache restoration; the browser
    // releases it on document destruction, or chooseClip releases it on selection.
  });
})();
