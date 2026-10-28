import fs from "node:fs";
import path from "node:path";
import { excludedFromDiscovery } from "./discovery-exclusions.js";

const documentExtensions = new Set([".pdf", ".csv"]);

export function documentSitemapPaths(recordsDirectory = "./public/records") {
  const urls = [];

  function visit(directory, segments = []) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const nextSegments = [...segments, entry.name];
      const filePath = path.join(directory, entry.name);
      const url = `/records/${nextSegments.map(encodeURIComponent).join("/")}`;
      if (excludedFromDiscovery(url)) continue;
      if (entry.isDirectory()) {
        visit(filePath, nextSegments);
      } else if (entry.isFile() && documentExtensions.has(path.extname(entry.name).toLowerCase())) {
        urls.push(url);
      }
    }
  }

  visit(recordsDirectory);
  return urls.sort();
}
