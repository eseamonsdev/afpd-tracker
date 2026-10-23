import fs from "node:fs";
import path from "node:path";

const timeFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Denver", hour: "numeric", minute: "2-digit", second: "2-digit"
});
const dateFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC", month: "long", day: "numeric", year: "numeric"
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
      "────────────────────────────────────────",
      `Radio ID${ids.length > 1 ? "s" : ""}: ${ids.length ? ids.join(", ") : "[not available]"}`,
      "",
      "Transcript:",
      text || "[no transcript available]"
    ].join("\n");
  });
  return [
    dateFormat.format(new Date(`${data.date}T12:00:00Z`)),
    "American Fork PD Car to Car",
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
    const filename = `transcript_${day.date.replaceAll("-", "_")}.txt`;
    fs.writeFileSync(path.join(folder, filename), formatRadioTranscript(data));
  }
}
