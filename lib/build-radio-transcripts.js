import fs from "node:fs";
import path from "node:path";

const timeFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Denver", hour: "numeric", minute: "2-digit", second: "2-digit"
});
// Match the player's chronological numbering and radio ID normalization.
export function formatRadioTranscript(data) {
  const calls = [...data.calls].sort((a, b) => a.epoch - b.epoch);
  const clips = calls.map((call, index) => {
    const ids = [...new Set([
      ...(Array.isArray(call.radio_ids) ? call.radio_ids : []),
      ...(Array.isArray(call.srcList) ? call.srcList.map(source => source?.src) : [])
    ].filter(id => typeof id === "string" || typeof id === "number")
      .map(id => String(id).trim()).filter(id => /^[1-9]\d*$/.test(id)))];
    const text = typeof call.transcript === "string" ? call.transcript.trim() : "";
    return [
      `${timeFormat.format(new Date(call.epoch * 1000))} — Clip ${index + 1}`,
      `Radio IDs: ${ids.length ? ids.join(", ") : "[not available]"}`,
      `Verified: ${call.validated === true ? "Yes" : "No"}`,
      "",
      text || "[no transcript available]",
      ...(typeof call.note === "string" && call.note.trim() ? ["", `Note: ${call.note.trim()}`] : [])
    ].join("\n");
  });
  return [
    `${data.date} — ${Number(data.talkgroup) === 5922 ? "Law 2 Northeast (5922)" : "American Fork PD Car to Car (6001)"}`,
    "Times: America/Denver",
    "",
    clips.join("\n\n\n")
  ].join("\n") + "\n";
}

// calls.json stays authoritative; these are disposable build outputs.
export function buildRadioTranscripts(index, directory = "public/records/openmhz") {
  for (const day of index.days) {
    const folder = path.join(directory, day.folder);
    const data = JSON.parse(fs.readFileSync(path.join(folder, "calls.json"), "utf8"));
    const filename = `afpd-car-to-car-transcript-${day.date}.txt`;
    fs.writeFileSync(path.join(folder, filename), formatRadioTranscript(data));
  }
}
