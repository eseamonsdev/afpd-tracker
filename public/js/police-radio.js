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

  // Temporary diagnostics only on staging and its Cloudflare branch previews.
  const diagnostics = createDiagnostics();
  function createDiagnostics() {
    if (typeof window === "undefined" || !/(^|-)afpd-tracker\.ericseamonsdeveloper\.workers\.dev$/.test(window.location.hostname)) return null;
    const history = [], playAttempts = [];
    const lastEvents = players.map(() => ({}));
    let expected = false, lastProgress = Date.now(), observedPlayer, observedTime = 0;
    let lastProblem = "", lastHeartbeat = Date.now(), requestedAt = null, lastPlayingAt = null;
    const button = document.createElement("button");
    button.id = "radio-debug-open"; button.type = "button";
    button.textContent = "Staging diagnostics: show report";
    const live = document.createElement("p");
    live.id = "radio-debug-live"; live.textContent = "Diagnostics: ready";
    live.style.cssText = "font:14px monospace;margin:8px 0;overflow-wrap:anywhere";
    const panel = document.createElement("section");
    panel.id = "radio-debug-panel"; panel.hidden = true;
    panel.setAttribute("role", "region"); panel.setAttribute("aria-label", "Playback diagnostics");
    panel.style.cssText = "position:fixed;bottom:12px;left:12px;right:12px;z-index:1000;background:#fff;color:#111;border:2px solid #963b00;border-radius:8px;padding:12px;max-height:55vh;overflow:auto;box-shadow:0 2px 12px #0005";
    const title = document.createElement("p"); title.setAttribute("role", "status");
    const instructions = document.createElement("p");
    instructions.textContent = "Copy this report or take a screenshot. Playback continues while this panel is open.";
    const report = document.createElement("textarea");
    report.id = "radio-debug-report"; report.readOnly = true;
    report.setAttribute("aria-label", "Playback diagnostic report");
    report.style.cssText = "display:block;width:100%;height:180px;font:12px monospace;color:#111;background:#fff";
    const copy = document.createElement("button"); copy.type = "button"; copy.textContent = "Copy report";
    const close = document.createElement("button"); close.type = "button"; close.textContent = "Close";
    panel.append(title, instructions, report, copy, close);
    audio.after(button, live); root.append(panel);
    function ranges(value) {
      const result = [];
      for (let i = 0; i < (value?.length ?? 0); i++) result.push([value.start(i), value.end(i)]);
      return result;
    }
    function state(player) {
      return { player: players.indexOf(player), active: player === audio, file: player.getAttribute("src"), currentSrc: player.currentSrc,
        time: player.currentTime, duration: Number.isFinite(player.duration) ? player.duration : null,
        paused: player.paused, ended: player.ended, seeking: player.seeking, readyState: player.readyState,
        networkState: player.networkState, playbackRate: player.playbackRate, muted: player.muted, volume: player.volume,
        buffered: ranges(player.buffered), seekable: ranges(player.seekable), played: ranges(player.played),
        decodedBytes: player.webkitAudioDecodedByteCount ?? null, lastEvents: { ...lastEvents[players.indexOf(player)] },
        error: player.error ? { code: player.error.code, message: player.error.message } : null };
    }
    function consistency() {
      const expectedSource = selected >= 0 && calls[selected] ? clipSource(selected) : null;
      const highlighted = buttons.map((button, index) => button.getAttribute("aria-current") === "true" ? index : -1).filter(index => index >= 0);
      const issues = [];
      if (expectedSource && audio.getAttribute("src") !== expectedSource) issues.push("Active player source differs from selected clip");
      if (expectedSource && audio.currentSrc && audio.readyState > 0 && !audio.currentSrc.endsWith(expectedSource)) issues.push("Browser currentSrc differs from selected clip");
      if (selected >= 0 && (highlighted.length !== 1 || highlighted[0] !== selected)) issues.push("Highlighted clip differs from selected clip");
      if (autoplay.getAttribute("aria-pressed") !== String(auto)) issues.push("Autoplay button differs from internal autoplay state");
      if (players.filter(player => !player.paused && !player.ended && player.getAttribute("src")).length > 1) issues.push("Both audio players are unpaused");
      return { issues, expectedSource, highlighted, activePlayer: players.indexOf(audio),
        nextPlayer: players.indexOf(nextAudio), permittedPlayer: players.indexOf(lastPlayingAudio), keepPlaybackPlayer };
    }
    function assessment(checks) {
      if (checks.issues.length) return "Player state mismatch";
      const attempt = playAttempts.findLast(item => item.token === playbackRequest);
      if (expected && attempt?.outcome === "pending") return "Play promise still pending";
      if (expected && attempt?.outcome === "resolved" && !audio.paused && audio.readyState >= 3 && audio.currentTime === 0 && Date.now() - lastProgress >= 10000) return "Play promise resolved, but browser playback clock never started";
      return "See playback events and progress snapshots";
    }
    function record(event, detail = {}) {
      if (event === "play request") {
        playAttempts.push({ token: detail.token, player: detail.player, source: detail.source,
          requestedAt: new Date().toISOString(), requestedMs: Date.now(), outcome: "pending" });
        const attempt = playAttempts.at(-1);
        for (const name of ["loadstart", "loadedmetadata", "canplay"]) {
          const event = lastEvents[detail.player][name];
          if (event?.source === detail.source) attempt[`${name}BeforePlayMs`] = Date.now() - Date.parse(event.at);
        }
        if (playAttempts.length > 40) playAttempts.shift();
      } else if (event === "play promise resolved" || event === "play promise rejected") {
        const attempt = playAttempts.findLast(item => item.token === detail.token);
        if (attempt) Object.assign(attempt, { outcome: event.endsWith("resolved") ? "resolved" : "rejected", stale: detail.stale,
          settledAt: new Date().toISOString(), settledAfterMs: Date.now() - attempt.requestedMs, errorName: detail.name, errorMessage: detail.message });
      }
      history.push({ at: new Date().toISOString(), event, selected: selected + 1, ...detail });
      if (history.length > 160) history.shift();
    }
    function show(reason) {
      const checks = consistency();
      title.textContent = `Playback diagnostic: ${reason}`;
      report.value = JSON.stringify({ version: "radio-staging-debug-3", reason, at: new Date().toISOString(),
        clip: current.textContent, selected: selected + 1, total: calls.length,
        autoplay: auto, expectedPlayback: expected, requestedAt, lastPlayingAt, playbackRequest, visibility: document.visibilityState,
        userAgent: window.navigator.userAgent, idleSeconds: (Date.now() - lastProgress) / 1000,
        consistency: checks, assessment: assessment(checks), playAttempts: playAttempts.map(item => ({ ...item })),
        players: players.map(state), history: [...history] }, null, 2);
      panel.hidden = false;
    }
    function problem(reason, detail = {}) {
      record(reason, detail);
      const key = `${reason}:${selected}:${audio.getAttribute("src")}`;
      if (key !== lastProblem) { lastProblem = key; show(reason); }
    }
    function expectPlaying(value) {
      if (value) { lastProblem = ""; requestedAt = new Date().toISOString(); }
      expected = value; lastProgress = Date.now(); observedPlayer = audio; observedTime = audio.currentTime;
      updateLive();
    }
    function updateLive() {
      const idle = Math.max(0, (Date.now() - lastProgress) / 1000);
      const phase = selected < 0 ? "Ready" : audio.error ? "Error" : audio.ended ? "Ended" :
        audio.paused ? "Paused" : audio.readyState < 3 ? "Loading" : idle >= 5 ? "No progress" : "Playing";
      live.textContent = `Diagnostics: ${phase} · ${current.textContent} · position ${audio.currentTime.toFixed(2)}s · no progress ${idle.toFixed(0)}s · autoplay ${auto ? "on" : "off"}`;
    }
    button.addEventListener("click", () => show("Manual report"));
    close.addEventListener("click", () => { panel.hidden = true; });
    copy.addEventListener("click", async () => {
      try { await window.navigator.clipboard.writeText(report.value); copy.textContent = "Copied"; }
      catch { report.focus(); report.select(); copy.textContent = "Select and copy the report"; }
    });
    for (const player of players) {
      for (const event of ["loadstart", "loadedmetadata", "canplay", "play", "playing", "waiting", "stalled", "suspend", "pause", "ended", "error", "abort", "emptied", "seeking", "seeked"]) {
        player.addEventListener(event, () => {
          lastEvents[players.indexOf(player)][event] = { at: new Date().toISOString(), time: player.currentTime, source: player.getAttribute("src"), observedRequestToken: playbackRequest };
          if (event === "playing" && player === audio) lastPlayingAt = new Date().toISOString();
          record(event, state(player));
          updateLive();
          if (event === "error") problem(player === audio ? "Active media error" : "Preload media error", state(player));
        });
      }
      player.addEventListener("timeupdate", () => {
        lastEvents[players.indexOf(player)].timeupdate = { at: new Date().toISOString(), time: player.currentTime, source: player.getAttribute("src"), observedRequestToken: playbackRequest };
      });
    }
    window.addEventListener("error", event => problem("JavaScript error", { message: event.message, file: event.filename, line: event.lineno, stack: event.error?.stack }));
    window.addEventListener("unhandledrejection", event => problem("Unhandled promise rejection", { message: String(event.reason), stack: event.reason?.stack }));
    document.addEventListener("visibilitychange", () => {
      record("visibilitychange", { visibility: document.visibilityState });
      // Background timer suspension is not evidence of a playback failure.
      lastProgress = Date.now();
    });
    window.setInterval(() => {
      if (audio !== observedPlayer || audio.currentTime !== observedTime) {
        observedPlayer = audio; observedTime = audio.currentTime; lastProgress = Date.now();
      }
      updateLive();
      if (selected >= 0 && Date.now() - lastHeartbeat >= 5000) {
        lastHeartbeat = Date.now();
        record("progress heartbeat", { autoplay: auto, expectedPlayback: expected, visibility: document.visibilityState,
          secondsWithoutProgress: (Date.now() - lastProgress) / 1000, playbackRequest, consistency: consistency(), players: players.map(state) });
      }
      if (!expected || selected < 0 || document.visibilityState === "hidden" || Date.now() - lastProgress < 10000) return;
      if (audio.ended) {
        if (auto && calls[selected + 1]) problem("Clip ended but autoplay did not advance");
      } else if (audio.paused) problem("Unexpected pause while playback was requested");
      else if (audio.readyState < 3) problem("Playback waiting for audio data for 10 seconds");
      else problem("Playback time stopped progressing for 10 seconds");
    }, 1000);
    record("Diagnostics enabled");
    return { record, problem, expectPlaying };
  }

  const clipSource = (index) => `${base}${encodeURIComponent(folder)}/${encodeURIComponent(calls[index].original_filename)}`;

  function clearAudio(player) {
    diagnostics?.record("Player cleared by application", { player: players.indexOf(player), active: player === audio, source: player.getAttribute("src") });
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
    diagnostics?.expectPlaying(false);
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
    diagnostics?.expectPlaying(true);
    diagnostics?.record("play request", { player: players.indexOf(player), source, token });
    try {
      await player.play();
      diagnostics?.record("play promise resolved", { player: players.indexOf(player), source, token, stale: token !== playbackRequest || player !== audio || source !== player.getAttribute("src") });
    } catch (error) {
      const stale = token !== playbackRequest || player !== audio || source !== player.getAttribute("src");
      diagnostics?.record("play promise rejected", { name: error.name, message: error.message, player: players.indexOf(player), source, token, stale });
      if (!stale && error.name !== "AbortError") diagnostics?.problem("Play request rejected", { name: error.name, message: error.message });
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
    diagnostics?.record("Clip switch pauses previous audio", { player: players.indexOf(audio), source: audio.getAttribute("src"), nextIndex: index });
    audio.pause();
    const source = clipSource(index);
    const prepared = !keepPlaybackPlayer && nextAudio.getAttribute("src") === source && !nextAudio.error;
    if (prepared) [audio, nextAudio] = [nextAudio, audio];
    clearAudio(nextAudio);
    selected = index;
    diagnostics?.record("clip selected", { index, prepared });
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
        button.addEventListener("click", () => {
          diagnostics?.record("User selected clip", { index, filename: call.original_filename });
          chooseClip(index);
        });
        row.append(button); fragment.append(row);
        return button;
      });
      list.append(fragment);
      status.textContent = calls.length ? `${dateFormat.format(dateObject(entry.date))} · ${calls.length} clips` : "No clips available for this day.";
    } catch (error) {
      if (token !== request || error.name === "AbortError") return;
      diagnostics?.problem("Day manifest failed", { message: error.message });
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
    diagnostics?.record("autoplay toggled", { enabled: auto });
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
      diagnostics?.expectPlaying(false);
      diagnostics?.record("User pressed Pause");
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
        diagnostics?.record("Autoplay advancing", { from: selected, to: selected + 1 });
        chooseClip(selected + 1);
      }
      else if (audio.ended) diagnostics?.expectPlaying(false);
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
    } catch (error) {
      diagnostics?.problem("Archive index failed", { message: error.message });
      month.replaceChildren(new Option("Unavailable", ""));
      day.replaceChildren(new Option("Unavailable", ""));
      status.textContent = "Unable to load available dates. Reload the page to try again.";
      section.setAttribute("aria-busy", "false");
    }
  }
  initialize();
})();
