(() => {
  "use strict";
  const root = document.getElementById("radio-archive");
  if (!root) return;
  const get = (name) => document.getElementById(`radio-${name}`);
  const month = get("month"), day = get("day");
  let audio = get("audio"), nextAudio = document.createElement("audio");
  audio.preload = nextAudio.preload = "auto";
  nextAudio.hidden = true;
  audio.after(nextAudio);
  const players = [audio, nextAudio];
  const play = get("play"), seek = get("seek"), autoplay = get("autoplay");
  const list = get("clips"), section = get("clips-section"), status = get("status");
  const current = get("current"), message = get("player-message");
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

  const clipSource = (index) => `${base}${encodeURIComponent(folder)}/${encodeURIComponent(calls[index].original_filename)}`;

  function clearAudio(player) {
    player.pause();
    if (player.hasAttribute("src")) {
      player.removeAttribute("src");
      player.load();
    }
  }

  function prepareNextClip() {
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
    selected = -1;
    playbackRequest++;
    players.forEach(clearAudio);
    play.disabled = true;
    seek.disabled = true;
    seek.value = 0;
    seek.max = 0;
    play.textContent = "Play";
    play.setAttribute("aria-label", "Play selected clip");
    get("elapsed").textContent = "0:00";
    get("duration").textContent = "0:00";
    current.textContent = "Choose a clip to listen";
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
    const prepared = !keepPlaybackPlayer && nextAudio.getAttribute("src") === source && !nextAudio.error;
    if (prepared) [audio, nextAudio] = [nextAudio, audio];
    clearAudio(nextAudio);
    selected = index;
    const call = calls[index];
    buttons[index].setAttribute("aria-current", "true");
    current.textContent = `${dateFormat.format(dateObject(day.value))} · ${timeFormat.format(new Date(call.epoch * 1000))}`;
    message.textContent = "";
    seek.disabled = true;
    seek.max = 0;
    seek.value = 0;
    get("elapsed").textContent = "0:00";
    get("duration").textContent = durationText(call.displayed_seconds);
    play.disabled = false;
    if (!prepared) {
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
    if (!entry) return;
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
      const fragment = document.createDocumentFragment();
      buttons = calls.map((call, index) => {
        const row = document.createElement("li");
        const button = document.createElement("button");
        button.type = "button"; button.className = "radio-clip";
        const time = document.createElement("time");
        time.dateTime = new Date(call.epoch * 1000).toISOString();
        time.textContent = timeFormat.format(new Date(call.epoch * 1000));
        const duration = document.createElement("span");
        duration.textContent = `${call.displayed_seconds} sec`;
        button.setAttribute("aria-label", `Play ${time.textContent}, ${call.displayed_seconds} seconds`);
        button.append(time, duration);
        button.addEventListener("click", () => chooseClip(index));
        row.append(button); fragment.append(row);
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

  function populateDays() {
    day.replaceChildren();
    for (const entry of days.filter((entry) => entry.date.startsWith(month.value))) {
      day.add(new Option(`${dateFormat.format(dateObject(entry.date))} — ${entry.count} clips`, entry.date));
    }
    day.disabled = !day.options.length;
    loadDay();
  }
  month.addEventListener("change", populateDays);
  day.addEventListener("change", loadDay);
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
    } else audio.pause();
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
      if (audio.ended && auto && selected >= 0 && selected + 1 < calls.length) chooseClip(selected + 1);
    });
    onActive("error", () => {
      if (selected >= 0 && audio.error) message.textContent = "This clip could not be loaded. Choose another clip or press Play to retry.";
    });
  }

  async function initialize() {
    try {
      const response = await fetch(`${base}index.json`);
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
      month.disabled = false;
      populateDays();
    } catch {
      month.replaceChildren(new Option("Unavailable", ""));
      day.replaceChildren(new Option("Unavailable", ""));
      status.textContent = "Unable to load available dates. Reload the page to try again.";
      section.setAttribute("aria-busy", "false");
    }
  }
  initialize();
})();
