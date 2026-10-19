import fs from "node:fs";
import path from "node:path";
import { excerptUrl } from "./radio-excerpt-identity.js";

const timeFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Denver", hour: "numeric", minute: "2-digit", second: "2-digit"
});
const dateFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Denver", month: "long", day: "numeric", year: "numeric"
});

// Resolve inclusive, stable filename ranges at build time. Fail rather than
// silently publishing a partial or changed selection when a boundary is missing.
export function buildRadioExcerpt(excerpt, directory = "public/records/openmhz") {
  const fail = (message) => { throw new Error(`Radio excerpt ${excerpt?.number}: ${message}`); };
  if (excerpt?.type !== "police-radio-excerpt" || !Number.isSafeInteger(excerpt.number) || excerpt.number < 1) fail("invalid excerpt entity");
  if (!Array.isArray(excerpt.sections) || !excerpt.sections.length) fail("sections are required");
  const url = excerptUrl(excerpt);
  if (typeof excerpt.subtitle !== "string" || !excerpt.subtitle.trim()) fail("a descriptive subtitle is required");
  if (excerpt.enableTranscription !== undefined && typeof excerpt.enableTranscription !== "boolean") fail("enableTranscription must be a boolean");
  const manifests = new Map(), seen = new Set();
  let previousEpoch = -Infinity, total = 0, seconds = 0;
  const sections = excerpt.sections.map((section) => {
    if (!Array.isArray(section.ranges) || !section.ranges.length) fail("each section needs ranges");
    const ranges = section.ranges.map((range) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(range.date)) fail("invalid range date");
      const folder = `openmhz-afpd-car-to-car-${range.date}`;
      if (!manifests.has(range.date)) {
        const manifest = JSON.parse(fs.readFileSync(path.join(directory, folder, "calls.json"), "utf8"));
        if (manifest.date !== range.date || !Array.isArray(manifest.calls)) fail("invalid manifest");
        const calls = [...manifest.calls].sort((a, b) => a.epoch - b.epoch);
        if (new Set(calls.map(c => c.original_filename)).size !== calls.length) fail("duplicate manifest filenames");
        manifests.set(range.date, calls);
      }
      const calls = manifests.get(range.date);
      const first = calls.findIndex(c => c.original_filename === range.first);
      const last = calls.findIndex(c => c.original_filename === (range.last || range.first));
      if (first < 0 || last < first) fail("missing or reversed range boundary");
      const selected = calls.slice(first, last + 1).map((call, index) => {
        const filename = call.original_filename;
        const key = `${range.date}/${filename}`;
        if (!/^[\w.-]+\.m4a$/.test(filename) || !Number.isFinite(call.epoch) || !Number.isFinite(call.displayed_seconds) || call.displayed_seconds < 0) fail("invalid call");
        if (seen.has(key) || call.epoch < previousEpoch) fail("overlapping or nonchronological ranges");
        if (!fs.existsSync(path.join(directory, folder, filename))) fail(`missing audio ${filename}`);
        seen.add(key); previousEpoch = call.epoch; total++; seconds += call.displayed_seconds;
        const date = new Date(call.epoch * 1000);
        return {
          number: first + index + 1, source: `/records/openmhz/${folder}/${filename}`,
          seconds: call.displayed_seconds, time: timeFormat.format(date),
          date: dateFormat.format(date), iso: date.toISOString(),
          transcript: excerpt.enableTranscription === true && typeof call.transcript === "string" ? call.transcript : ""
        };
      });
      return { calls: selected, label: `${selected[0].date} · ${selected[0].time}–${selected.at(-1).time}`, clipLabel: first === last ? `Clip ${first + 1}` : `Clips ${first + 1}–${last + 1}` };
    });
    return { title: section.title || "", description: section.description || "", ranges };
  });
  return { ...excerpt, url, sections, total, durationSeconds: seconds, duration: `${Math.floor(seconds / 60)} min ${seconds % 60} sec` };
}
