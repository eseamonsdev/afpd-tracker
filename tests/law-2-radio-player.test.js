import { rowTemplate } from "./radio-row-fixture.js";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../public/js/radio-player-core.js", import.meta.url), "utf8") + "\n" + readFileSync(new URL("../public/js/law-2-radio.js", import.meta.url), "utf8");

class Element {
  constructor(tag = "div") {
    this.tag = tag;
    this.attrs = new Map();
    this.style = {};
    this.readyState = 4;
    this.listeners = new Map();
    this.children = [];
    this.options = [];
    this.value = "";
    this.textContent = "";
    this.paused = true;
    this.ended = false;
    this.duration = NaN;
    this.currentTime = 0;
    this.error = null;
    this.loads = 0;
  }
  set src(value) { this.attrs.set("src", value); }
  set textContent(value) { this._text = value; this.children = []; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(""); }
  get src() { return this.getAttribute("src"); }
  setAttribute(key, value) { this.attrs.set(key, String(value)); }
  getAttribute(key) { return this.attrs.get(key) ?? null; }
  hasAttribute(key) { return this.attrs.has(key); }
  removeAttribute(key) { this.attrs.delete(key); }
  addEventListener(name, handler) {
    const listeners = this.listeners.get(name) ?? [];
    listeners.push(handler);
    this.listeners.set(name, listeners);
  }
  emit(name, event = {}) { for (const handler of this.listeners.get(name) ?? []) handler(event); }
  contains(element) { return this === element || this.children.some(child => child.contains(element)); }
  focus() { this.emit("focus"); }
  click() { this.emit("click"); }
  pause() { if (!this.paused) { this.paused = true; this.emit("pause"); } }
  play() {
    this.paused = false;
    this.ended = false;
    this.emit("play");
    this.emit("playing");
    return Promise.resolve();
  }
  load() { this.loads++; this.duration = NaN; this.currentTime = 0; this.error = null; this.ended = false; }
  after(...elements) { this.sibling = elements[0]; this.afterElements = elements; }
  append(...children) {
    for (const child of children) this.children.push(...(child.tag === "fragment" ? child.children : [child]));
  }
  replaceChildren(...children) { this._text = ""; this.children = children; this.options = []; this.value = ""; }
  add(option) { this.options.push(option); if (this.options.length === 1) this.value = option.value; }
}

async function playerFixture(fixtureCalls, hostname, fixtureDate = "2026-09-11", search = "", transcriptEnabled = true, associations = null, manifestEnabled = transcriptEnabled, afpdRadioIds = [], agencyRadioIds = {}, confirmations = null) {
  const elements = new Map(["archive", "month", "day", "audio", "play", "seek", "autoplay",
    "clips", "clips-section", "status", "current", "current-radio-ids", "player-message", "elapsed", "duration",
    "coverage", "transcript-toggle", "transcript-download", "transcript", "transcript-status", "transcript-text", "transcript-availability", "verification-count", "transcription-count", "review-progress", "progress-date"]
    .map(name => [`law2-radio-${name}`, new Element(name === "audio" ? "audio" : "div")]));
  elements.get("law2-radio-autoplay").setAttribute("aria-pressed", "false");
  const players = [elements.get("law2-radio-audio")];
  const dates = [fixtureDate, "2026-09-10"];
  const fetchedAudio = [], metadataRequests = [], revokedUrls = [], objectSources = new Map(), failedAudio = new Set();
  let objectNumber = 0;
  const window = { location: new URL(`https://${hostname ?? "localhost"}/law-2-radio/${search}`) };
  const replacements = [];
  window.history = {
    state: { preserved: true },
    replaceState(state, _, href) {
      replacements.push(href);
      window.location = new URL(href);
      this.state = state;
    }
  };
  const document = {
    getElementById: id => id === "radio-clip-row-template" ? rowTemplate(Element) : elements.get(id),
    createElementNS: (_, tag) => new Element(tag),
    createDocumentFragment: () => new Element("fragment"),
    createElement(tag) {
      const element = new Element(tag);
      if (tag === "audio") players.push(element);
      return element;
    }
  };
  vm.runInNewContext(source, {
    document, window, Intl, Date, AbortController,
    URL: class extends URL {
      static createObjectURL(blob) {
        const url = `blob:test-${++objectNumber}`;
        objectSources.set(url, blob.source);
        return url;
      }
      static revokeObjectURL(url) { revokedUrls.push(url); }
    },
    Option: class { constructor(text, value) { this.text = text; this.value = value; } },
    fetch: async (url, options) => {
      if (url.endsWith("officer-confirmations.json")) return { ok: true, json: async () => confirmations };
      if (url.endsWith("officer-associations.json")) {
        if (associations instanceof Error) throw associations;
        return { ok: true, json: async () => associations };
      }
      if (url.endsWith(".m4a")) {
        fetchedAudio.push(url);
        if (failedAudio.has(url)) return { ok: false };
        return { ok: true, blob: async () => ({ source: url }) };
      }
      metadataRequests.push({ url, options });
      return { ok: true, json: async () => url.endsWith("index.json")
        ? { afpdRadioIds, agencyRadioIds, days: dates.map(date => ({ date, folder: `openmhz-afpd-law-2-${date}`, enableDay: true, enableTranscription: typeof transcriptEnabled === "function" ? transcriptEnabled(date) : transcriptEnabled, count: fixtureCalls?.length ?? 4 })) }
        : { date: dates.find(date => url.includes(date)), enableTranscription: typeof manifestEnabled === "function" ? manifestEnabled(dates.find(date => url.includes(date))) : manifestEnabled, calls: fixtureCalls ?? Array.from({ length: 4 }, (_, i) => ({
          epoch: 1789100000 + i * 10, displayed_seconds: 5, original_filename: `call-${i}.m4a`
        })) } };
    }
  });
  await new Promise(resolve => setImmediate(resolve));
  const get = name => elements.get(`law2-radio-${name}`);
  const select = i => get("clips").children[i].children[0].click();
  const active = () => players.find(player => !player.paused);
  const finish = player => { player.ended = true; player.paused = true; player.emit("ended"); };
  return { get, select, players, active, finish, fetchedAudio, metadataRequests, revokedUrls, failedAudio, window, replacements,
    settle: () => new Promise(resolve => setImmediate(resolve)),
    sourceFor: player => objectSources.get(player.src) ?? player.src };
}

test("Law 2 selection, verified transcript and autoplay use its separate audio archive", async () => {
  const f = await playerFixture([
    { epoch: 1789100000, displayed_seconds: 5, original_filename: "one.m4a", transcript: "5J47?", validated: true, radio_ids: [14590042] },
    { epoch: 1789100010, displayed_seconds: 5, original_filename: "two.m4a", transcript: "Go ahead." }
  ]);
  assert.equal(f.get("transcript").hidden, true);
  f.get("transcript-toggle").click();
  f.select(0);
  await f.settle();
  assert.equal(f.get("transcript-text").textContent, "5J47?");
  assert.equal(f.get("transcript-status").textContent, "✓ Verified");
  assert.equal(f.get("current-radio-ids").textContent, "Radio ID: 14590042");
  assert.match(f.active().src, /openmhz-afpd-law-2-2026-09-11\/one.m4a$/);
  f.get("autoplay").click();
  await f.settle();
  f.finish(f.active());
  await f.settle();
  assert.equal(f.get("transcript-text").textContent, "Go ahead.");
  assert.equal(f.get("transcript-status").textContent, "AI-generated · Unverified");
});

test("changing to an audio-only day hides transcript controls and downloads", async () => {
  const f = await playerFixture([
    { epoch: 1789100000, displayed_seconds: 5, original_filename: "one.m4a", transcript: "Go ahead." }
  ], undefined, "2026-09-11", "", date => date === "2026-09-11");
  assert.equal(f.get("transcript-download").hidden, false);
  f.get("day").value = "2026-09-10";
  f.get("day").emit("change");
  await f.settle();
  assert.equal(f.get("transcript-download").hidden, true);
  assert.equal(f.get("transcript-download").getAttribute("href"), null);
  assert.equal(f.get("transcript-toggle").hidden, true);
  f.select(0);
  assert.equal(f.get("transcript").hidden, true);
});

test("October 1–3 transcript controls use enabled index entries even without a manifest flag", async () => {
  for (const date of ["2026-10-01", "2026-10-02", "2026-10-03"]) {
    const f = await playerFixture([
      { epoch: 1790834427, displayed_seconds: 2, original_filename: "one.m4a", transcript: "[unclear]", note: "Review against audio." }
    ], undefined, date, `?date=${date}`, true, null, () => undefined);
    assert.equal(f.get("transcript-toggle").hidden, false, date);
    assert.equal(f.get("transcript-toggle").disabled, false, date);
    assert.equal(f.get("transcript-download").getAttribute("download"), `law-2-transcript-${date}.txt`);
    assert.equal(f.get("transcript-download").getAttribute("href"), `/records/openmhz/openmhz-afpd-law-2-${date}/law-2-transcript-${date}.txt`);
    assert.equal(f.get("transcript-availability").hidden, true);
    f.get("transcript-toggle").click();
    f.select(0);
    await f.settle();
    assert.equal(f.get("transcript").hidden, false);
    assert.equal(f.get("transcript-text").textContent, "[unclear]");
    assert.equal(f.get("transcript-status").textContent, "AI-generated · Unverified");
    assert.equal(f.metadataRequests.length, 2);
    assert.ok(f.metadataRequests.every(request => request.options?.cache === "no-cache"));
  }
});

test("older indexes fall back to the manifest without overriding an explicit disabled date", async () => {
  const calls = [{ epoch: 1790834427, displayed_seconds: 2, original_filename: "one.m4a", transcript: "Go ahead." }];
  const older = await playerFixture(calls, undefined, "2026-10-01", "", () => undefined, null, true);
  assert.equal(older.get("transcript-toggle").disabled, false);
  const disabled = await playerFixture(calls, undefined, "2026-10-01", "", false, null, true);
  assert.equal(disabled.get("transcript-toggle").hidden, true);
  assert.equal(disabled.get("transcript-download").hidden, true);
});

test("query dates outside the enabled index cannot load an unlisted day", async () => {
  const f = await playerFixture(undefined, undefined, "2026-09-11", "?date=2026-10-31");
  assert.equal(f.get("day").value, "2026-09-11");
  assert.equal(f.window.location.search, "?date=2026-09-11");
  f.get("day").value = "2026-10-31";
  f.get("day").emit("change");
  await f.settle();
  assert.equal(f.get("clips").children.length, 0);
  assert.equal(f.get("status").textContent, "This date is not enabled.");
});

test("Law 2 uses the same dated names, strength labels and SVG evidence controls as 6001", async () => {
  for (const [status, label] of [['confirmed', 'Confirmed this day'], ['strong', 'Strong association'], ['single-day', 'Single-day association']]) {
    const associations = { schema_version: 2, days: { '2026-09-12': {
      '14590026': { name: 'Test Officer', status, evidence_days: 2, evidence_dates: ['2026-09-11', '2026-09-12'] }
    } } };
    const f = await playerFixture([{ epoch: 1789239600, displayed_seconds: 2, original_filename: 'one.m4a', radio_ids: [14590026] }],
      undefined, '2026-09-12', '', false, associations);
    const ids = f.get('clips').children[0].children[1];
    assert.match(ids.textContent, new RegExp(`Test Officer · ${label}`));
    const info = ids.children[1].children[3], button = info.children[0], popup = info.children[1];
    assert.equal(button.children[0].tag, 'svg');
    assert.equal(button.children[0].getAttribute('aria-hidden'), 'true');
    assert.match(button.getAttribute('aria-label'), /Test Officer/);
    assert.equal(popup.children[1].href, '/police-radio-resources/#radio-id-14590026');
    button.click();
    assert.equal(popup.hidden, false);
    assert.equal(f.active(), undefined, 'information does not start audio');
    f.select(0);
    await f.settle();
    assert.match(f.get('current-radio-ids').textContent, /Test Officer/);
    f.get('day').value = '2026-09-10'; f.get('day').emit('change'); await f.settle();
    if (status === 'strong') assert.match(f.get('clips').children[0].children[1].textContent, /Test Officer · Strong association/);
    else assert.equal(f.get('clips').children[0].children[1].textContent, 'Radio ID: 14590026', 'dated confirmations and single-day-only names do not become strong fallbacks');
  }
});


test("904 IDs show Dispatch without person associations in rows, labels and current clip", async () => {
  const f = await playerFixture([
    { epoch: 1789100000, displayed_seconds: 2, original_filename: "dispatch.m4a", radio_ids: [9040011, "9040007", 14590400] },
    { epoch: 1789100010, displayed_seconds: 2, original_filename: "source-list.m4a", srcList: [{ src: 9040013 }] }
  ], undefined, "2026-09-11", "", false, { schema_version: 2, days: { "2026-09-11": {
    "9040011": { name: "Must not appear", status: "confirmed" },
    "14590400": { name: "Field Officer", status: "confirmed" }
  } } });
  const row = f.get("clips").children[0], ids = row.children[1];
  assert.match(ids.textContent, /9040011 · Dispatch/);
  assert.match(ids.textContent, /9040007 · Dispatch/);
  assert.match(ids.textContent, /14590400 · Field Officer · Confirmed this day/);
  assert.equal(ids.children[1].children.length, 2, "dispatch has only its numeric ID and role label");
  assert.equal(ids.children[3].children.length, 2);
  assert.doesNotMatch(ids.textContent, /Must not appear/);
  assert.match(row.children[0].getAttribute("aria-label"), /9040011 · Dispatch/);
  f.select(0); await f.settle();
  assert.match(f.get("current-radio-ids").textContent, /9040011 · Dispatch/);
  assert.match(f.get("clips").children[1].children[1].textContent, /9040013 · Dispatch/);
  f.get("day").value = "2026-09-10"; f.get("day").emit("change"); await f.settle();
  assert.match(f.get("clips").children[0].children[1].textContent, /9040011 · Dispatch/);
});

test("Law 2 AFPD fallback follows 6001 membership while Dispatch and dated names take priority", async () => {
  const f = await playerFixture([
    { epoch: 1789100000, displayed_seconds: 2, original_filename: 'one.m4a', radio_ids: [9040011, 14590026, 14590027, 14590028] }
  ], undefined, '2026-09-11', '', false, { schema_version: 2, days: { '2026-09-11': {
    '14590026': { name: 'Test Officer', status: 'confirmed' }
  } } }, false, ['9040011', '14590026', '14590027', 'bad', 0]);
  const ids = f.get('clips').children[0].children[1];
  assert.match(ids.textContent, /9040011 · Dispatch/);
  assert.match(ids.textContent, /14590026 · Test Officer · Confirmed this day/);
  assert.match(ids.textContent, /14590027 · AFPD/);
  assert.equal(ids.children[5].children.length, 2, 'AFPD has just the number and fallback label');
  assert.equal(ids.children[7].textContent, '14590028', 'unknown IDs remain numeric');
  assert.match(f.get('clips').children[0].children[0].getAttribute('aria-label'), /14590027 · AFPD/);
  f.select(0); await f.settle();
  assert.match(f.get('current-radio-ids').textContent, /14590027 · AFPD/);
  f.get('day').value = '2026-09-10'; f.get('day').emit('change'); await f.settle();
  assert.match(f.get('clips').children[0].children[1].textContent, /14590026 · AFPD/, 'dated person association does not extend to another day');
});


test("corrected agency ID overrides AFPD fallback in row, audio label and current clip", async () => {
  const f = await playerFixture([
    { epoch: 1789100000, displayed_seconds: 2, original_filename: 'one.m4a', radio_ids: [14580068] }
  ], undefined, '2026-09-11', '', false, null, false, ['14580068'], { '14580068': '18J16' });
  const row = f.get('clips').children[0];
  assert.match(row.children[1].textContent, /14580068 · 18J16/);
  assert.doesNotMatch(row.children[1].textContent, /AFPD/);
  assert.match(row.children[0].getAttribute('aria-label'), /14580068 · 18J16/);
  f.select(0); await f.settle();
  assert.match(f.get('current-radio-ids').textContent, /14580068 · 18J16/);
});


test("strong names carry to Law 2-only dates, respecting withheld dates and conflicting names", async () => {
  const associations = { schema_version: 2, withheld_dates: { '2026-09-10': ['14590026'] }, days: {
    '2026-09-12': {
      '14590026': { name: 'Known Officer', status: 'strong', evidence_days: 2, evidence_dates: ['2026-09-12', '2026-09-13'] },
      '14590027': { name: 'One Day', status: 'single-day', evidence_days: 1 },
      '14590028': { name: 'First Name', status: 'strong', evidence_days: 2 }
    },
    '2026-09-13': { '14590028': { name: 'Other Name', status: 'confirmed', evidence_days: 2 } }
  } };
  const f = await playerFixture([
    { epoch: 1789100000, displayed_seconds: 2, original_filename: 'one.m4a', radio_ids: [14590026,14590027,14590028] }
  ], undefined, '2026-09-11', '', false, associations);
  const row = f.get('clips').children[0];
  assert.match(row.children[1].textContent, /Known Officer · Strong association/);
  assert.doesNotMatch(row.children[1].textContent, /Confirmed this day|One Day|First Name|Other Name/);
  assert.match(row.children[0].getAttribute('aria-label'), /Known Officer · Strong association/);
  f.select(0); await f.settle();
  assert.match(f.get('current-radio-ids').textContent, /Known Officer · Strong association/);
  f.get('day').value = '2026-09-10'; f.get('day').emit('change'); await f.settle();
  assert.doesNotMatch(f.get('clips').children[0].children[1].textContent, /Known Officer/);
});


test("September 27 owner confirmation renders Garcia as confirmed on radio 14590111", async () => {
  const associations = JSON.parse(readFileSync(new URL('../public/records/openmhz/officer-associations.json', import.meta.url), 'utf8'));
  const confirmations = JSON.parse(readFileSync(new URL('../public/records/openmhz/officer-confirmations.json', import.meta.url), 'utf8'));
  const f = await playerFixture([
    { epoch: 1790535600, displayed_seconds: 2, original_filename: 'one.m4a', radio_ids: [14590111] }
  ], undefined, '2026-09-27', '', false, associations, false, [], {}, confirmations);
  assert.match(f.get('clips').children[0].children[1].textContent, /14590111 · Diego O. Garcia · Confirmed this day/);
  f.select(0); await f.settle();
  assert.match(f.get('current-radio-ids').textContent, /Diego O. Garcia · Confirmed this day/);
});


test("progress counts nonblank transcripts and explicit approvals separately across days", async () => {
  const calls = [
    { transcript: "Approved", validated: true },
    { transcript: "AI draft", validated: false },
    { transcript: "  ", validated: "true" },
    { transcript: null },
    { transcript: 42 },
    {}
  ].map((call, i) => ({ ...call, epoch: 1789100000 + i * 10,
    displayed_seconds: 5, original_filename: `count-${i}.m4a` }));
  const f = await playerFixture(calls);
  const transcribed = f.get("transcription-count"), verified = f.get("verification-count");
  const progress = f.get("review-progress");
  assert.equal(f.get("progress-date").textContent, "for 09/11/2026");
  assert.equal(transcribed.textContent, "2 / 6");
  assert.equal(verified.textContent, "1 / 6");
  assert.equal(progress.hidden, false);
  calls[0].validated = false;
  calls[1].transcript = "";
  f.get("day").value = "2026-09-10";
  f.get("day").emit("change");
  assert.equal(progress.hidden, true);
  assert.equal(f.get("progress-date").textContent, "");
  assert.equal(transcribed.textContent, "");
  assert.equal(verified.textContent, "");
  await f.settle();
  assert.equal(f.get("progress-date").textContent, "for 09/10/2026");
  assert.equal(transcribed.textContent, "1 / 6");
  assert.equal(verified.textContent, "0 / 6");
  assert.equal(progress.hidden, false);
});

test("an empty day displays zero out of zero for both progress counts", async () => {
  const f = await playerFixture([]);
  assert.equal(f.get("transcription-count").textContent, "0 / 0");
  assert.equal(f.get("verification-count").textContent, "0 / 0");
});
