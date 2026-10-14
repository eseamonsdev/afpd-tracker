import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { documentSitemapPaths } from "../lib/build-document-sitemap.js";

test("document sitemap traverses nested folders, filters extensions, and encodes URLs", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "document-sitemap-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  for (const name of ["report.pdf", "nested/deeper/table.CSV", "nested/a & b#%.PDF", "photo.jpg", "nested/scan.png", "video.mp4", "calls.json", "audio.m4a"]) {
    const target = path.join(directory, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, "fixture");
  }
  fs.symlinkSync(path.join(directory, "report.pdf"), path.join(directory, "alias.pdf"));
  assert.deepEqual(documentSitemapPaths(directory), [
    "/records/nested/a%20%26%20b%23%25.PDF",
    "/records/nested/deeper/table.CSV",
    "/records/report.pdf"
  ]);
});
