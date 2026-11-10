import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildLaw2RadioIndex } from "../lib/build-law-2-radio-index.js";

test("non-5J dated callsigns exclude assisting radios from AFPD across dates, without extending callsigns", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "law2-agency-"));
  t.after(() => fs.rmSync(root, {recursive:true, force:true}));
  const source = path.join(root, "openmhz-afpd-car-to-car-2026-11-04");
  fs.mkdirSync(source);
  fs.writeFileSync(path.join(source,"calls.json"), JSON.stringify({talkgroup:6001,calls:[
    {radio_ids:["14750172","14580068","14590079","14759999"]}
  ]}));
  const days = ["2026-11-04","2026-11-05"].map(date => ({date,enableDay:true,enableTranscription:false}));
  days[0].agencyRadioIds = {"14750172":"7J20","14759999":"18J99"};
  for (const day of days) {
    const folder = path.join(root, "openmhz-afpd-law-2-"+day.date); fs.mkdirSync(folder);
    fs.writeFileSync(path.join(folder,"one.m4a"), "audio");
    fs.writeFileSync(path.join(folder,"calls.json"),JSON.stringify({date:day.date,talkgroup:5922,calls:[
      {epoch:Date.parse(day.date+"T12:00:00Z")/1000,original_filename:"one.m4a",displayed_seconds:2}
    ]}));
  }
  const settings = path.join(root,"settings.json");fs.writeFileSync(settings,JSON.stringify({days}));
  const index = buildLaw2RadioIndex(root,settings);
  assert.deepEqual(index.afpdRadioIds,["14590079"]);
  assert.equal(index.agencyRadioIds["14580068"],undefined);
  assert.deepEqual(index.days.find(d=>d.date==="2026-11-04").agencyRadioIds,days[0].agencyRadioIds);
  assert.equal(index.days.find(d=>d.date==="2026-11-05").agencyRadioIds,undefined);
});
