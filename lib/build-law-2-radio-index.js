import fs from "node:fs";
import path from "node:path";

// Separate settings/index from the car-to-car player and recording manifests.
function audioAvailable(call, folder, directory) {
  if (typeof call.original_filename !== "string" || !/^[\w.-]+\.m4a$/.test(call.original_filename) ||
      !Number.isFinite(call.epoch) || !Number.isFinite(call.displayed_seconds) || call.displayed_seconds < 0) return false;
  const local = path.join(directory, folder, call.original_filename);
  if (fs.existsSync(local) && fs.statSync(local).isFile() && fs.statSync(local).size > 0) return true;
  const storage = call.audio_storage;
  return storage?.provider === "r2" && storage.verified === true &&
    typeof storage.bucket === "string" && storage.bucket.length > 0 &&
    [`openmhz/${folder}/${call.original_filename}`, `records/openmhz/${folder}/${call.original_filename}`].includes(storage.key) &&
    /^[a-f0-9]{64}$/.test(call.sha256 ?? "") && storage.sha256 === call.sha256 &&
    Number.isInteger(call.size_bytes) && call.size_bytes > 0 && storage.size_bytes === call.size_bytes;
}

function transcriptText(data) {
  const time = new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", hour: "numeric", minute: "2-digit", second: "2-digit" });
  return [`${data.date} — Law 2 Northeast (5922)`, "Times: America/Denver", "",
    ...[...data.calls].sort((a, b) => a.epoch - b.epoch).map((call, i) => {
      const ids = [...new Set([
        ...(Array.isArray(call.radio_ids) ? call.radio_ids : []),
        ...(Array.isArray(call.srcList) ? call.srcList.map(source => source?.src) : [])
      ].filter(id => typeof id === "string" || typeof id === "number")
        .map(id => String(id).trim()).filter(id => /^[1-9]\d*$/.test(id)))];
      return `${time.format(new Date(call.epoch * 1000))} — Clip ${i + 1}\nRadio IDs: ${ids.join(", ") || "[not available]"}\nVerified: ${call.validated === true ? "Yes" : "No"}\n\n${call.transcript?.trim() || "[no transcript available]"}${call.note?.trim() ? `\n\nNote: ${call.note.trim()}` : ""}\n`;
    })].join("\n\n") + "\n";
}

export function buildLaw2RadioIndex(directory = "public/records/openmhz", settingsFile = "data/law-2-radio-days.json") {
  const settings = JSON.parse(fs.readFileSync(settingsFile, "utf8"));
  if (!Array.isArray(settings.days)) throw new Error("Law 2 settings require a days array");
  const days = [], seen = new Set();
  const dateFormat = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Denver", year: "numeric", month: "2-digit", day: "2-digit" });
  for (const setting of settings.days) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(setting.date) || seen.has(setting.date)) throw new Error("Invalid or duplicate Law 2 date");
    seen.add(setting.date);
    for (const flag of ["enableDay", "enableTranscription"]) {
      if (setting[flag] !== undefined && typeof setting[flag] !== "boolean") throw new Error(`Law 2 ${flag} must be a boolean`);
    }
    // New manifests never become visible without an explicit opt-in.
    if (setting.enableDay !== true) continue;
    const folder = `openmhz-afpd-law-2-${setting.date}`;
    const manifest = path.join(directory, folder, "calls.json");
    if (!fs.existsSync(manifest)) continue;
    const data = JSON.parse(fs.readFileSync(manifest, "utf8"));
    if (data.date !== setting.date || Number(data.talkgroup) !== 5922 || !Array.isArray(data.calls)) throw new Error(`Invalid Law 2 manifest: ${manifest}`);
    // Suppress the entire date if any listed recording is unavailable.
    if (!data.calls.length || !data.calls.every(call => audioAvailable(call, folder, directory))) continue;
    const filenames = new Set();
    for (const call of data.calls) {
      if (filenames.has(call.original_filename) || dateFormat.format(new Date(call.epoch * 1000)) !== data.date) throw new Error(`Duplicate audio or wrong date in ${manifest}`);
      filenames.add(call.original_filename);
    }
    const enableTranscription = setting.enableTranscription === true && data.calls.some(call => typeof call.transcript === "string" && call.transcript.trim());
    const coverageNote = [
      data.archive_scope ? `Selection: ${data.archive_scope}.` : "Archive coverage does not establish complete reception of this day.",
      data.partial_source_day === true ? "Partial source day." : "",
      data.coverage_note || ""
    ].filter(Boolean).join(" ");
    days.push({ date: data.date, folder, count: data.calls.length, enableDay: true, enableTranscription, coverageNote });
    const transcriptFile = path.join(directory, folder, `transcript_${data.date.replaceAll("-", "_")}.txt`);
    if (enableTranscription) fs.writeFileSync(transcriptFile, transcriptText(data));
    else if (fs.existsSync(transcriptFile)) fs.unlinkSync(transcriptFile);
  }
  const index = { timezone: "America/Denver", talkgroup: 5922, days: days.sort((a, b) => b.date.localeCompare(a.date)) };
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "law-2-index.json"), JSON.stringify(index, null, 2) + "\n");
  return index;
}
