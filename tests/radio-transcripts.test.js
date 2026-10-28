import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildRadioTranscripts, formatRadioTranscript } from "../lib/build-radio-transcripts.js";

test("export matches player ordering, Mountain time, IDs and transcript fallbacks", () => {
  const data = { date: "2026-10-21", calls: [
    { epoch: 1792566170, transcript: "  [unclear]\nSecond line.  ",
      radio_ids: ["14590107", "14590107", 0, null], srcList: [{ src: 14590020 }, { src: "bad" }] },
    { epoch: 1792566124, transcript: "Possible 55.", validated: true, radio_ids: ["14590345"] },
    ...[undefined, "", "  \n", null, 123].map((transcript, i) => ({ epoch: 1792566200 + i, transcript }))
  ] };
  const original = JSON.stringify(data);
  const text = formatRadioTranscript(data);
  assert.ok(text.startsWith("2026-10-21 — American Fork PD Car to Car (6001)\nTimes: America/Denver\n\n"));
  assert.ok(text.includes("1:02:04 AM — Clip 1\nRadio IDs: 14590345\nVerified: Yes\n\nPossible 55."));
  assert.ok(text.includes("\n\n\n1:02:50 AM — Clip 2\nRadio IDs: 14590107, 14590020\nVerified: No\n\n[unclear]\nSecond line."));
  assert.equal(text.split("[no transcript available]").length - 1, 5);
  assert.equal(text.split("Radio IDs: [not available]").length - 1, 5);
  assert.equal(text.split("Verified: Yes").length - 1, 1);
  assert.equal(text.split("Verified: No").length - 1, 6);
  assert.equal(JSON.stringify(data), original);
  const law2 = formatRadioTranscript({ ...data, talkgroup: 5922 });
  assert.ok(law2.startsWith("2026-10-21 — Law 2 Northeast (5922)\nTimes: America/Denver\n"));
  assert.equal(law2.slice(law2.indexOf("\n")), text.slice(text.indexOf("\n")), "both talkgroups share the same transcript structure");
  const player = fs.readFileSync(new URL("../public/js/radio-player-core.js", import.meta.url), "utf8");
  assert.ok(player.includes('content || "[no transcript available]"'));
  const winter = formatRadioTranscript({ date: "2026-12-01", calls: [{ epoch: Date.parse("2026-12-01T14:31:43Z") / 1000 }] });
  assert.ok(winter.includes("7:31:43 AM — Clip 1"));
});

test("build creates dated exports and regenerates corrections from calls.json", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "radio-transcripts-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const day = { date: "2026-10-21", folder: "openmhz-afpd-car-to-car-2026-10-21" };
  const folder = path.join(directory, day.folder);
  fs.mkdirSync(folder);
  const manifest = path.join(folder, "calls.json");
  const data = { date: day.date, calls: [{ epoch: 1792566124, transcript: "First version." }] };
  fs.writeFileSync(manifest, JSON.stringify(data));
  buildRadioTranscripts({ days: [day] }, directory);
  const output = path.join(folder, "afpd-car-to-car-transcript-2026-10-21.txt");
  assert.equal(fs.readFileSync(output, "utf8"), formatRadioTranscript(data));
  data.calls[0].transcript = "Corrected wording.";
  fs.writeFileSync(manifest, JSON.stringify(data));
  buildRadioTranscripts({ days: [day] }, directory);
  assert.equal(fs.readFileSync(output, "utf8"), formatRadioTranscript(data));
  assert.deepEqual(fs.readdirSync(folder).sort(), ["afpd-car-to-car-transcript-2026-10-21.txt", "calls.json"]);
});
