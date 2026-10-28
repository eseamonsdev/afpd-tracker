import fs from "node:fs";

// Central exclusions for recursive sitemap scans and any future site search.
const { excludedPathPrefixes } = JSON.parse(fs.readFileSync(
  new URL("../data/discovery-exclusions.json", import.meta.url), "utf8"
));

export function excludedFromDiscovery(url) {
  return excludedPathPrefixes.some(prefix => url.startsWith(prefix));
}
