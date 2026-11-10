import fs from "node:fs";
import path from "node:path";
import { formatRadioTranscript } from "./build-radio-transcripts.js";
import { unavailableAudio } from "./build-radio-index.js";

const agencyCorrections = JSON.parse(fs.readFileSync(new URL("../data/radio-agency-corrections.json", import.meta.url), "utf8"));

// Observation on 6001 is a fallback; explicit agency corrections take priority.
function idsObservedOn6001(directory, nonAfpdIds) {
  const ids = new Set();
  if (!fs.existsSync(directory)) return [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^openmhz-afpd-car-to-car-\d{4}-\d{2}-\d{2}$/.test(entry.name)) continue;
    const file = path.join(directory, entry.name, "calls.json");
    if (!fs.existsSync(file)) continue;
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    if (Number(data.talkgroup) !== 6001) continue;
    for (const call of data.calls ?? []) {
      if (Number(call.talkgroup ?? data.talkgroup) !== 6001) continue;
      const sources = [
        ...(Array.isArray(call.radio_ids) ? call.radio_ids : []),
        ...(Array.isArray(call.srcList) ? call.srcList.map(source => source?.src) : [])
      ];
      for (const value of sources) {
        if (!["string", "number"].includes(typeof value)) continue;
        const id = String(value).trim();
        if (/^[1-9]\d*$/.test(id) && !nonAfpdIds.has(id)) ids.add(id);
      }
    }
  }
  return [...ids].sort((a, b) => Number(a) - Number(b));
}

// Separate settings/index from the car-to-car player and recording manifests.
function audioAvailable(call, folder, directory) {
  if (typeof call.original_filename !== "string" || !/^[\w.-]+\.m4a$/.test(call.original_filename) ||
      !Number.isFinite(call.epoch) || !Number.isFinite(call.displayed_seconds) || call.displayed_seconds < 0) return false;
  if (call.audio_status === "unavailable") {
    const placeholder = path.join(directory, "place-holder-audio.m4a");
    return unavailableAudio(call) && fs.existsSync(placeholder) && fs.statSync(placeholder).isFile() && fs.statSync(placeholder).size > 0;
  }
  const local = path.join(directory, folder, call.original_filename);
  if (fs.existsSync(local) && fs.statSync(local).isFile() && fs.statSync(local).size > 0) return true;
  const storage = call.audio_storage;
  return storage?.provider === "r2" && storage.verified === true &&
    typeof storage.bucket === "string" && storage.bucket.length > 0 &&
    [`openmhz/${folder}/${call.original_filename}`, `records/openmhz/${folder}/${call.original_filename}`].includes(storage.key) &&
    /^[a-f0-9]{64}$/.test(call.sha256 ?? "") && storage.sha256 === call.sha256 &&
    Number.isInteger(call.size_bytes) && call.size_bytes > 0 && storage.size_bytes === call.size_bytes;
}

export function buildLaw2RadioIndex(directory = "public/records/openmhz", settingsFile = "data/law-2-radio-days.json") {
  const settings = JSON.parse(fs.readFileSync(settingsFile, "utf8"));
  if (!Array.isArray(settings.days)) throw new Error("Law 2 settings require a days array");
  // A confirmed non-5J callsign establishes another agency, but the exact
  // callsign remains dated. Do not infer AFPD membership from mutual aid on 6001.
  const nonAfpdIds = new Set(Object.entries(agencyCorrections)
    .filter(([, entry]) => entry.afpd === false || (/^\d+J\d+$/.test(entry.agencyId ?? '') && !entry.agencyId.startsWith('5J')))
    .map(([id]) => id));
  for (const day of settings.days) {
    for (const [id, label] of Object.entries(day.agencyRadioIds ?? {})) {
      if (/^[1-9]\d*$/.test(id) && typeof label === 'string' && /^\d+J\d+$/.test(label) && !label.startsWith('5J')) nonAfpdIds.add(id);
    }
  }
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
    const agencyRadioIds = setting.agencyRadioIds;
    if (agencyRadioIds !== undefined && (!agencyRadioIds || typeof agencyRadioIds !== 'object' || Array.isArray(agencyRadioIds) || Object.entries(agencyRadioIds).some(([id, label]) => !/^[1-9]\d*$/.test(id) || typeof label !== 'string' || !/^\d+J\d+$/.test(label)))) throw new Error('Invalid dated Law 2 agency identifiers');
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
    days.push({ date: data.date, folder, count: data.calls.length, enableDay: true, enableTranscription, coverageNote, ...(agencyRadioIds ? { agencyRadioIds } : {}) });
    const transcriptFile = path.join(directory, folder, `law-2-transcript-${data.date}.txt`);
    if (enableTranscription) fs.writeFileSync(transcriptFile, formatRadioTranscript(data));
    else if (fs.existsSync(transcriptFile)) fs.unlinkSync(transcriptFile);
  }
  const index = { timezone: "America/Denver", talkgroup: 5922, afpdRadioIds: idsObservedOn6001(directory, nonAfpdIds), agencyRadioIds: Object.fromEntries(Object.entries(agencyCorrections).filter(([, entry]) => /^5J\d+$/.test(entry.agencyId ?? '')).map(([id, entry]) => [id, entry.agencyId])), days: days.sort((a, b) => b.date.localeCompare(a.date)) };
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "law-2-index.json"), JSON.stringify(index, null, 2) + "\n");
  return index;
}
