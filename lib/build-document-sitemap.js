import fs from "node:fs";
import path from "node:path";

const documentExtensions = new Set([".pdf", ".csv"]);

export function documentSitemapPaths(recordsDirectory = "./public/records") {
  const urls = [];

  function visit(directory, segments = []) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const nextSegments = [...segments, entry.name];
      const filePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(filePath, nextSegments);
      } else if (entry.isFile() && documentExtensions.has(path.extname(entry.name).toLowerCase())) {
        urls.push(`/records/${nextSegments.map(encodeURIComponent).join("/")}`);
      }
    }
  }

  visit(recordsDirectory);
  return urls.sort();
}
