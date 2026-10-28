import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildLaw2RadioIndex } from "../lib/build-law-2-radio-index.js";
import { documentSitemapPaths } from "../lib/build-document-sitemap.js";
import { excludedFromDiscovery } from "../lib/discovery-exclusions.js";
import worker from "../src/worker.js";

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "law2-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const folder = "openmhz-afpd-law-2-2026-10-01";
  fs.mkdirSync(path.join(directory, folder));
  const settingsFile = path.join(directory, "settings.json");
  const setting = { date: "2026-10-01", enableDay: true, enableTranscription: true };
  const call = { original_filename: "one.m4a", epoch: 1790834427, displayed_seconds: 2, transcript: "5J47, go ahead." };
  const data = { date: setting.date, talkgroup: 5922, calls: [call] };
  const write = () => {
    fs.writeFileSync(settingsFile, JSON.stringify({ days: [setting] }));
    fs.writeFileSync(path.join(directory, folder, "calls.json"), JSON.stringify(data));
  };
  const build = () => { write(); return buildLaw2RadioIndex(directory, settingsFile); };
  const audio = path.join(directory, folder, call.original_filename);
  const transcript = path.join(directory, folder, "transcript_2026_10_01.txt");
  return { directory, folder, setting, call, data, audio, transcript, build };
}

test("explicit date opt-in and all listed audio are required", t => {
  const f = fixture(t);
  assert.equal(f.build().days.length, 0);
  fs.writeFileSync(f.audio, "audio");
  assert.equal(f.build().days.length, 1);
  delete f.setting.enableDay;
  assert.equal(f.build().days.length, 0);
  f.setting.enableDay = false;
  assert.equal(f.build().days.length, 0);
  f.setting.enableDay = true;
  f.data.calls.push({ ...f.call, original_filename: "missing.m4a" });
  assert.equal(f.build().days.length, 0, "one missing clip suppresses the whole date");
});

test("R2 proof must match the filename, size and checksum", t => {
  const f = fixture(t);
  f.call.sha256 = "a".repeat(64);
  f.call.size_bytes = 100;
  f.call.audio_storage = { provider: "r2", verified: true, bucket: "archive", key: `openmhz/${f.folder}/one.m4a`, sha256: f.call.sha256, size_bytes: 100 };
  assert.equal(f.build().days.length, 1);
  f.call.audio_storage.sha256 = "b".repeat(64);
  assert.equal(f.build().days.length, 0);
  f.call.audio_storage.sha256 = f.call.sha256;
  f.call.audio_storage.key = "different/one.m4a";
  assert.equal(f.build().days.length, 0);
});

test("transcript settings are independent and downloads require available text", t => {
  const f = fixture(t);
  fs.writeFileSync(f.audio, "audio");
  assert.equal(f.build().days[0].enableTranscription, true);
  assert.match(fs.readFileSync(f.transcript, "utf8"), /Law 2 Northeast/);
  f.setting.enableTranscription = false;
  assert.equal(f.build().days[0].enableTranscription, false);
  assert.equal(fs.existsSync(f.transcript), false);
  f.setting.enableTranscription = true;
  delete f.call.transcript;
  assert.equal(f.build().days[0].enableTranscription, false);
});

test("wrong talkgroups, dates and duplicate clips fail validation", t => {
  const f = fixture(t);
  fs.writeFileSync(f.audio, "audio");
  f.data.talkgroup = 6001;
  assert.throws(f.build, /Invalid Law 2 manifest/);
  f.data.talkgroup = 5922;
  f.data.calls.push({ ...f.call });
  assert.throws(f.build, /Duplicate audio/);
  f.data.calls.pop();
  f.call.epoch -= 86400;
  assert.throws(f.build, /wrong date/);
});

test("recursive PDF/CSV discovery skips excluded folders and keeps existing documents", t => {
  const f = fixture(t);
  for (const name of ["ordinary/report.pdf", "ordinary/table.csv", `openmhz/${f.folder}/future-report.pdf`, `openmhz/${f.folder}/nested/future.csv`]) {
    const file = path.join(f.directory, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "fixture");
  }
  assert.deepEqual(documentSitemapPaths(f.directory), ["/records/ordinary/report.pdf", "/records/ordinary/table.csv"]);
  assert.equal(excludedFromDiscovery("/law-2-radio/"), true);
  assert.equal(excludedFromDiscovery("/police-radio/"), false);
});

test("review page and raw Law 2 files receive noindex without changing other pages", async () => {
  const env = { ASSETS: { fetch: async () => new Response("fixture") } };
  for (const url of ["/law-2-radio/", "/records/openmhz/law-2-index.json", "/records/openmhz/openmhz-afpd-law-2-2026-10-01/transcript_2026_10_01.txt"]) {
    const response = await worker.fetch(new Request(`https://example.test${url}`), env);
    assert.equal(response.headers.get("X-Robots-Tag"), "noindex, nofollow");
  }
  const other = await worker.fetch(new Request("https://example.test/police-radio/"), env);
  assert.equal(other.headers.get("X-Robots-Tag"), null);
  const stored = { size: 10, httpEtag: '"clip"', writeHttpMetadata() {} };
  const audio = await worker.fetch(new Request("https://example.test/records/openmhz/openmhz-afpd-law-2-2026-10-01/dcfems-5922-1790834427.m4a"), {
    ASSETS: { fetch: async () => new Response(null, { status: 404 }) },
    RADIO_AUDIO: { head: async () => stored, get: async () => ({ body: "recording" }) }
  });
  assert.equal(audio.status, 200);
  assert.equal(audio.headers.get("X-Robots-Tag"), "noindex, nofollow");
  assert.equal(await audio.text(), "recording");
});

test("AFPD membership is rebuilt from 6001 source IDs, excluding other talkgroups and transcript text", t => {
  const f = fixture(t); fs.writeFileSync(f.audio, 'audio');
  const source = path.join(f.directory, 'openmhz-afpd-car-to-car-2026-10-02');
  fs.mkdirSync(source);
  const write = calls => fs.writeFileSync(path.join(source, 'calls.json'), JSON.stringify({ talkgroup: 6001, calls }));
  write([{ radio_ids: [14590027, '14590026', 0, -1, 'bad'], srcList: [{ src: 14590027 }, { src: '14590028' }], transcript: 'Radio ID 99999999' },
    { talkgroup: 5922, radio_ids: [12345678] }]);
  assert.deepEqual(f.build().afpdRadioIds, ['14590026', '14590027', '14590028']);
  write([{ radio_ids: [14590029] }]);
  assert.deepEqual(f.build().afpdRadioIds, ['14590029'], 'membership reflects current authoritative manifests');
});
