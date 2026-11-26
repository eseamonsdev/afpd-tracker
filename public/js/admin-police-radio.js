(() => {
  const pending = new Map();
  const save = document.getElementById("admin-save");
  const status = document.getElementById("admin-save-status");
  const pencil = document.getElementById("radio-edit-transcript");
  const editor = document.getElementById("radio-transcript-editor");
  const textarea = document.getElementById("radio-transcript-input");
  const checkbox = document.getElementById("radio-verified");
  const transcriptText = document.getElementById("radio-transcript-text");
  const highlightToggle = document.getElementById("admin-highlight-unverified");
  const clipList = document.getElementById("radio-clips");
  const exportCommand = "make calls-from-db";
  let saving = false;
  let currentCalls = [];
  let selected = null;
  let highlightUnverified = false;
  let updateCurrent = () => {};

  function refreshHighlights() {
    const unverified = currentCalls.filter(call => call.validated !== true).length;
    highlightToggle.hidden = unverified === 0;
    highlightToggle.textContent = `Highlight unverified: ${highlightUnverified ? "On" : "Off"}`;
    highlightToggle.setAttribute("aria-pressed", String(highlightUnverified));
    clipList.classList.toggle("admin-highlight-unverified", highlightUnverified && unverified > 0);
    currentCalls.forEach((call, index) => {
      clipList.children[index]?.classList.toggle("admin-unverified", call.validated !== true);
    });
  }
  highlightToggle.addEventListener("click", () => {
    highlightUnverified = !highlightUnverified;
    refreshHighlights();
  });

  function refreshStatus(message) {
    save.disabled = saving || !pending.size;
    status.textContent = message || (pending.size
      ? `${pending.size} unsaved clip${pending.size === 1 ? "" : "s"}.`
      : "No unsaved changes.");
  }
  function stage(call, original) {
    if (call.transcript === original.transcript && call.validated === original.validated) {
      pending.delete(call.id);
    } else {
      pending.set(call.id, { id: call.id, transcript: call.transcript, validated: call.validated,
        expected_transcript: original.transcript, expected_validated: original.validated });
    }
    const eligible = currentCalls.filter(item => item.audio_status !== "unavailable");
    document.getElementById("radio-transcription-count").textContent = `${eligible.filter(item => item.transcript?.trim()).length} / ${eligible.length}`;
    document.getElementById("radio-verification-count").textContent = `${eligible.filter(item => item.validated).length} / ${eligible.length}`;
    refreshHighlights();
    refreshStatus();
  }
  async function enrichCalls(calls, entry, signal) {
    const url = new URL("/admin/api/radio-transcripts", location.origin);
    url.searchParams.set("date", entry.date);
    url.searchParams.set("talkgroup", document.getElementById("radio-talkgroup").value);
    const clips = [];
    for (;;) {
      url.searchParams.set("offset", String(clips.length));
      const response = await fetch(url, { signal, cache: "no-store" });
      if (!response.ok) throw new Error(`Database request failed (${response.status})`);
      const page = await response.json();
      clips.push(...page.clips);
      if (!page.has_more) break;
    }
    const byId = new Map(clips.map(clip => [clip.id, clip]));
    if (byId.size !== calls.length || calls.some(call => !byId.has(call.id))) {
      throw new Error("Database clips do not match the public archive for this date");
    }
    for (const call of calls) {
      const current = byId.get(call.id);
      call._original = { transcript: current.transcript, validated: current.validated };
      call.transcript = pending.get(call.id)?.transcript ?? current.transcript ?? "";
      call.validated = pending.get(call.id)?.validated ?? current.validated;
    }
  }
  function onDayRendered(calls, list, entry, updateTranscript) {
    currentCalls = calls;
    updateCurrent = updateTranscript;
    for (const row of list.children) {
      const badge = document.createElement("span");
      badge.className = "admin-unverified-badge";
      badge.textContent = "Unverified";
      row.append(badge);
    }
    refreshHighlights();
    document.getElementById("radio-archive").dispatchEvent(new CustomEvent("admin-radio-day-ready", {
      detail: { calls, list, entry, talkgroup: Number(document.getElementById("radio-talkgroup").value) }
    }));
  }
  function onClipSelected(call) {
    selected = call;
    if (!call) {
      currentCalls = [];
      highlightToggle.hidden = true;
      clipList.classList.remove("admin-highlight-unverified");
    }
    editor.hidden = true;
    transcriptText.hidden = false;
    pencil.setAttribute("aria-expanded", "false");
    pencil.setAttribute("aria-label", "Edit transcript");
    pencil.title = "Edit transcript";
    pencil.disabled = !call;
    textarea.value = call?.transcript || "";
    checkbox.disabled = !call;
    checkbox.checked = call?.validated === true;
    document.getElementById("radio-archive").dispatchEvent(new CustomEvent("admin-radio-clip-selected", { detail: { call } }));
  }
  pencil.addEventListener("click", () => {
    if (!selected) return;
    editor.hidden = !editor.hidden;
    transcriptText.hidden = !editor.hidden;
    pencil.setAttribute("aria-expanded", String(!editor.hidden));
    pencil.setAttribute("aria-label", editor.hidden ? "Edit transcript" : "Done editing");
    pencil.title = editor.hidden ? "Edit transcript" : "Done editing";
    if (editor.hidden) updateCurrent();
    else textarea.focus();
  });
  textarea.addEventListener("input", () => {
    if (!selected) return;
    selected.transcript = textarea.value;
    stage(selected, selected._original);
  });
  checkbox.addEventListener("change", () => {
    if (!selected) return;
    selected.validated = checkbox.checked;
    stage(selected, selected._original);
    if (editor.hidden) updateCurrent();
  });
  save.addEventListener("click", async () => {
    if (!pending.size || saving) return;
    saving = true;
    refreshStatus("Saving changes…");
    try {
      for (const batch of Array.from(pending.values()).reduce((batches, item, index) => {
        if (index % 100 === 0) batches.push([]);
        batches.at(-1).push(item);
        return batches;
      }, [])) {
        const response = await fetch("/admin/api/radio-transcripts", {
          method: "POST", headers: { "Content-Type": "application/json" },
          credentials: "same-origin", body: JSON.stringify({ changes: batch })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || `Save failed (${response.status})`);
        for (const change of batch) {
          const latest = pending.get(change.id);
          if (latest?.transcript === change.transcript && latest.validated === change.validated) {
            pending.delete(change.id);
          } else if (latest) {
            pending.set(change.id, { ...latest, expected_transcript: change.transcript,
              expected_validated: change.validated });
          }
          const call = currentCalls.find(item => item.id === change.id);
          if (call) call._original = { transcript: change.transcript, validated: change.validated };
        }
      }
      refreshStatus(`Changes saved to the database. Run ${exportCommand} to update the site JSON.`);
    } catch (error) {
      refreshStatus(`${error.message} Your unsaved edits are still here.`);
    } finally {
      saving = false;
      save.disabled = !pending.size;
    }
  });
  window.addEventListener("beforeunload", event => {
    if (pending.size) { event.preventDefault(); event.returnValue = ""; }
  });
  RadioPlayer.archive({ rootId: "radio-archive", prefix: "radio", law2: false, adminTranscripts: true,
    enrichCalls, onDayRendered, onClipSelected });
})();
