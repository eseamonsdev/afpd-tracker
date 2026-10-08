import fs from "node:fs";
import path from "node:path";

// The archive index is derived from manifests; audio files are never modified.
export function buildRadioIndex(directory = "public/records/openmhz") {
  const days = [];
  const dates = new Set();
  if (fs.existsSync(directory)) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifest = path.join(directory, entry.name, "calls.json");
      if (!fs.existsSync(manifest)) continue;
      const data = JSON.parse(fs.readFileSync(manifest, "utf8"));
      if (!/^\d{4}-\d{2}-\d{2}$/.test(data.date) || !Array.isArray(data.calls)) {
        throw new Error(`Invalid radio manifest: ${manifest}`);
      }
      if (dates.has(data.date)) throw new Error(`Duplicate radio date: ${data.date}`);
      if (!data.calls.length) continue;
      const filenames = new Set();
      const dateFormatter = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Denver", year: "numeric", month: "2-digit", day: "2-digit"
      });
      for (const call of data.calls) {
        const filename = call.original_filename;
        if (typeof filename !== "string" || !/^[\w.-]+\.m4a$/.test(filename) ||
            !Number.isFinite(call.epoch) ||
            !Number.isFinite(call.displayed_seconds) || call.displayed_seconds < 0 ||
            !fs.existsSync(path.join(directory, entry.name, filename))) {
          throw new Error(`Missing audio or invalid call in ${manifest}: ${filename}`);
        }
        if (filenames.has(filename)) throw new Error(`Duplicate audio in ${manifest}: ${filename}`);
        filenames.add(filename);
        if (dateFormatter.format(new Date(call.epoch * 1000)) !== data.date) {
          throw new Error(`Call outside the Mountain Time date in ${manifest}: ${filename}`);
        }
      }
      dates.add(data.date);
      days.push({ date: data.date, folder: entry.name, count: data.calls.length });
    }
  }
  days.sort((a, b) => b.date.localeCompare(a.date));
  fs.mkdirSync(directory, { recursive: true });
  const index = { timezone: "America/Denver", days };
  fs.writeFileSync(path.join(directory, "index.json"), `${JSON.stringify(index, null, 2)}\n`);
  return index;
}
