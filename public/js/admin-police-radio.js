(() => {
  const pending = new Map();
  const save = document.getElementById("admin-save");
  const status = document.getElementById("admin-save-status");
  const exportCommand = location.hostname.startsWith("staging-")
    ? "make calls-from-db D1_DATABASE=afpd-data-staging" : "make calls-from-db";
  let saving = false;
  let currentCalls = [];
  let updateCurrent = () => {};

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
    updateCurrent();
    const eligible = currentCalls.filter(item => item.audio_status !== "unavailable");
    document.getElementById("radio-transcription-count").textContent = `${eligible.filter(item => item.transcript?.trim()).length} / ${eligible.length}`;
    document.getElementById("radio-verification-count").textContent = `${eligible.filter(item => item.validated).length} / ${eligible.length}`;
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
    for (const [index, call] of calls.entries()) {
      const row = list.children[index];
      const controls = document.createElement("div");
      controls.className = "admin-radio-controls";
      controls.addEventListener("click", event => event.stopPropagation());
      const pencil = document.createElement("button");
      pencil.type = "button";
      pencil.className = "admin-radio-pencil";
      pencil.textContent = "✎ Edit transcript";
      pencil.setAttribute("aria-expanded", "false");
      const editor = document.createElement("div");
      editor.className = "admin-radio-editor";
      editor.hidden = true;
      const label = document.createElement("label");
      label.textContent = `Clip ${index + 1} transcript`;
      const textarea = document.createElement("textarea");
      textarea.value = call.transcript || "";
      textarea.rows = 5;
      label.append(textarea);
      const verifyLabel = document.createElement("label");
      verifyLabel.className = "admin-radio-verify";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = call.validated === true;
      verifyLabel.append(checkbox, " Verified against audio");
      editor.append(label, verifyLabel);
      pencil.addEventListener("click", () => {
        editor.hidden = !editor.hidden;
        pencil.setAttribute("aria-expanded", String(!editor.hidden));
        if (!editor.hidden) textarea.focus();
      });
      textarea.addEventListener("input", () => { call.transcript = textarea.value; stage(call, call._original); });
      checkbox.addEventListener("change", () => { call.validated = checkbox.checked; stage(call, call._original); });
      controls.append(pencil, editor);
      row.append(controls);
    }
  }
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
    enrichCalls, onDayRendered });
})();
