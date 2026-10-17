(() => {
  "use strict";
  const root = document.getElementById("radio-excerpt");
  if (!root) return;
  const get = name => root.querySelector(`#excerpt-${name}`);
  const audio = get("audio"), play = get("play"), seek = get("seek");
  const autoplay = get("autoplay"), showCurrent = get("show-current");
  const message = get("player-message"), current = get("current");
  const buttons = Array.from(root.querySelectorAll("[data-excerpt-clip]"));
  // A single persistent element preserves Safari's user-granted playback permission.
  audio.preload = "auto";
  let selected = -1, auto = false, playbackRequest = 0;
  let prefetched = null, prefetchController = null, activeObjectUrl = null;
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
