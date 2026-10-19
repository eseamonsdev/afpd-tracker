import fs from "node:fs";
import path from "node:path";

// Only remove obsolete generated excerpt HTML after a successful full build.
// Incremental/JSON builds do not provide a complete list of written pages.
export function cleanRadioExcerpts({ directories, results, outputMode, incremental }) {
  if (outputMode !== "fs" || incremental) return;
  const directory = path.resolve(directories.output, "police-radio/excerpts");
  if (!fs.existsSync(directory)) return;
  const current = new Set(results.filter(r => r.outputPath).map(r => path.resolve(r.outputPath)));
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.name)) continue;
    const folder = path.join(directory, entry.name);
    const html = path.join(folder, "index.html");
    if (current.has(html)) continue;
    fs.rmSync(html, { force: true });
    if (fs.readdirSync(folder).length === 0) fs.rmdirSync(folder);
  }
}
