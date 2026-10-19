import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { excerptUrl, validateExcerptIdentities } from "../lib/radio-excerpt-identity.js";
import { cleanRadioExcerpts } from "../lib/clean-radio-excerpts.js";

test("excerpt URLs stay stable through title and display changes; invalid and duplicate identities fail", () => {
  const excerpt = { number: 5, slug: "2026-09-12-photographing-a-traffic-stop", subtitle: "Original title" };
  assert.equal(excerptUrl({ ...excerpt, subtitle: "Revised title", number: 99 }), excerptUrl(excerpt));
  assert.equal(validateExcerptIdentities([excerpt]), true);
  for (const slug of ["5", "../escape", "Uppercase", "", undefined]) assert.throws(() => excerptUrl({ ...excerpt, slug }), /slug/);
  assert.throws(() => validateExcerptIdentities([excerpt, { ...excerpt, number: 6 }]), /Duplicate/);
  assert.throws(() => validateExcerptIdentities([excerpt, { ...excerpt, slug: "different-slug" }]), /unique/);
});

test("full-build cleanup removes hidden slug pages and obsolete numbered pages, preserving audio and active pages", () => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), "radio-excerpts-"));
  try {
    const root = path.join(output, "police-radio/excerpts");
    for (const name of ["5", "hidden-excerpt", "active-excerpt"]) {
      fs.mkdirSync(path.join(root, name), { recursive: true });
      fs.writeFileSync(path.join(root, name, "index.html"), "page");
    }
    const audio = path.join(root, "hidden-excerpt", "original.m4a"); fs.writeFileSync(audio, "audio");
    const active = path.join(root, "active-excerpt", "index.html");
    const args = { directories: { output }, results: [{ outputPath: active }], outputMode: "fs", incremental: false };
    cleanRadioExcerpts({ ...args, incremental: true });
    assert.ok(fs.existsSync(path.join(root, "5/index.html")));
    cleanRadioExcerpts(args);
    assert.ok(!fs.existsSync(path.join(root, "5")));
    assert.ok(!fs.existsSync(path.join(root, "hidden-excerpt/index.html")));
    assert.ok(fs.existsSync(audio)); assert.ok(fs.existsSync(active));
  } finally { fs.rmSync(output, { recursive: true, force: true }); }
});
