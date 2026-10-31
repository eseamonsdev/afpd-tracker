import { rowTemplate } from "./radio-row-fixture.js";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../public/js/radio-player-core.js", import.meta.url), "utf8") + "\n" + readFileSync(new URL("../public/js/police-radio.js", import.meta.url), "utf8");

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

async function playerFixture(fixtureCalls, hostname, fixtureDate = "2026-09-11", search = "", transcriptEnabled = true, associations = null) {
  const elements = new Map(["archive", "month", "day", "audio", "play", "seek", "autoplay",
    "clips", "clips-section", "status", "current", "current-radio-ids", "player-message", "elapsed", "duration",
    "transcript-toggle", "transcript-download", "transcript", "transcript-status", "transcript-text", "transcript-availability", "verification-count", "transcription-count", "review-progress"]
    .map(name => [`radio-${name}`, new Element(name === "audio" ? "audio" : "div")]));
  elements.get("radio-autoplay").setAttribute("aria-pressed", "false");
  const players = [elements.get("radio-audio")];
  const dates = [fixtureDate, "2026-09-10"];
  const fetchedAudio = [], revokedUrls = [], objectSources = new Map(), failedAudio = new Set();
  let objectNumber = 0;
  const window = { location: new URL(`https://${hostname ?? "localhost"}/police-radio/${search}`) };
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
    fetch: async (url) => {
      if (url.endsWith("officer-associations.json")) {
        if (associations instanceof Error) throw associations;
        return { ok: true, json: async () => associations };
      }
      if (url.endsWith(".m4a")) {
        fetchedAudio.push(url);
        if (failedAudio.has(url)) return { ok: false };
        return { ok: true, blob: async () => ({ source: url }) };
      }
      return { ok: true, json: async () => url.endsWith("index.json")
        ? { days: dates.map(date => ({ date, folder: date, count: fixtureCalls?.length ?? 4 })) }
        : { date: dates.find(date => url.includes(date)), enableTranscription: typeof transcriptEnabled === "function" ? transcriptEnabled(dates.find(date => url.includes(date))) : transcriptEnabled, calls: fixtureCalls ?? Array.from({ length: 4 }, (_, i) => ({
          epoch: 1789100000 + i * 10, displayed_seconds: 5, original_filename: `call-${i}.m4a`
        })) } };
    }
  });
  await new Promise(resolve => setImmediate(resolve));
  const get = name => elements.get(`radio-${name}`);
  const select = i => get("clips").children[i].children[0].click();
  const active = () => players.find(player => !player.paused);
  const finish = player => { player.ended = true; player.paused = true; player.emit("ended"); };
  return { get, select, players, active, finish, fetchedAudio, revokedUrls, failedAudio, window, replacements,
    settle: () => new Promise(resolve => setImmediate(resolve)),
    sourceFor: player => objectSources.get(player.src) ?? player.src };
}

test("transcript panel follows manual selection, autoplay, day resets and visibility", async () => {
  const calls = [
    { epoch: 1789100000, displayed_seconds: 5, original_filename: "verified.m4a", transcript: "Reviewed [unclear] wording.", validated: true },
    { epoch: 1789100010, displayed_seconds: 5, original_filename: "draft.m4a", transcript: "<b>Unverified draft</b>", validated: false }
  ];
  const f = await playerFixture(calls);
  const toggle = f.get("transcript-toggle"), panel = f.get("transcript");
  assert.equal(panel.hidden, true);
  assert.equal(toggle.disabled, false);
  toggle.click();
  assert.equal(toggle.getAttribute("aria-pressed"), "true");
  assert.equal(f.get("transcript-text").textContent, "Choose a clip to see its transcript.");
  f.select(0);
  assert.equal(f.get("transcript-text").textContent, calls[0].transcript);
  assert.equal(f.get("transcript-status").textContent, "✓ Verified");
  assert.equal(f.get("transcript-status").getAttribute("data-verified"), "true");
  f.get("autoplay").click();
  f.finish(f.active());
  assert.equal(f.get("transcript-text").textContent, calls[1].transcript);
  assert.equal(f.get("transcript-text").children.length, 0, "transcripts remain plain text");
  assert.equal(f.get("transcript-status").textContent, "AI-generated · Unverified");
  assert.equal(f.get("transcript-status").getAttribute("data-verified"), "false");
  f.get("day").value = "2026-09-10";
  f.get("day").emit("change");
  await f.settle();
  assert.equal(f.get("transcript-text").textContent, "Choose a clip to see its transcript.");
  assert.equal(f.get("transcript-status").hidden, true);
  toggle.click();
  assert.equal(panel.hidden, true);
  assert.equal(f.get("transcript-text").textContent, "");
});

test("missing, blank and malformed transcripts use the fallback without a review badge", async () => {
  const values = [undefined, "", "  ", null, 17];
  const f = await playerFixture(values.map((transcript, index) => ({
    epoch: 1789100000 + index * 10, displayed_seconds: 5,
    original_filename: `missing-${index}.m4a`, transcript, validated: true
  })));
  f.get("transcript-toggle").click();
  values.forEach((_, index) => {
    f.select(index);
    assert.equal(f.get("transcript-text").textContent, "[no transcript available]");
    assert.equal(f.get("transcript-status").hidden, true);
    assert.ok(f.active(), "missing text must not block audio playback");
  });
});

test("days without enabled transcripts hide the button and panel while audio still plays", async () => {
  for (const flag of [false, null, "true"]) {
    const f = await playerFixture([
      { epoch: 1789100000, displayed_seconds: 5, original_filename: "hidden.m4a", transcript: "Existing text" }
    ], undefined, "2026-09-11", "", flag);
    assert.equal(f.get("transcript-toggle").hidden, true);
    assert.equal(f.get("transcript-toggle").disabled, true);
    assert.equal(f.get("transcript").hidden, true);
    assert.equal(f.get("transcript-availability").hidden, false);
    f.get("transcript-toggle").click();
    f.select(0);
    assert.equal(f.get("transcript").hidden, true);
    assert.equal(f.get("transcript-text").textContent, "");
    assert.ok(f.active());
  }
});

test("switching days respects transcript availability and clears the previous clip text", async () => {
  const f = await playerFixture([
    { epoch: 1789100000, displayed_seconds: 5, original_filename: "draft.m4a", transcript: "First day's draft" }
  ], undefined, "2026-09-11", "", date => date === "2026-09-11");
  f.get("transcript-toggle").click();
  f.select(0);
  assert.equal(f.get("transcript-text").textContent, "First day's draft");
  f.get("day").value = "2026-09-10";
  f.get("day").emit("change");
  await f.settle();
  assert.equal(f.get("transcript-toggle").hidden, true);
  assert.equal(f.get("transcript").hidden, true);
  assert.equal(f.get("transcript-text").textContent, "");
  f.get("day").value = "2026-09-11";
  f.get("day").emit("change");
  await f.settle();
  assert.equal(f.get("transcript-toggle").hidden, false);
  assert.equal(f.get("transcript-toggle").disabled, false);
  assert.equal(f.get("transcript-availability").hidden, true);
  assert.equal(f.get("transcript-text").textContent, "Choose a clip to see its transcript.");
});

test("autoplay hands off a prepared clip without reloading it and immediately prepares the following clip", async () => {
  const f = await playerFixture();
  f.get("autoplay").click();
  f.select(0);
  const [first, second] = f.players;
  assert.match(second.src, /call-1\.m4a$/);
  second.duration = 7;
  second.emit("loadedmetadata");
  assert.equal(f.get("seek").disabled, true, "standby metadata must not update current controls");
  const loads = second.loads;
  f.finish(first);
  assert.equal(f.active(), second);
  assert.equal(second.loads, loads);
  assert.equal(f.get("seek").max, 7);
  assert.equal(f.get("seek").disabled, false);
  assert.match(first.src, /call-2\.m4a$/);
  first.emit("pause");
  first.emit("error");
  first.emit("ended");
  assert.equal(f.get("play").textContent, "Pause");
  assert.equal(f.get("player-message").textContent, "");
  assert.equal(f.active(), second, "late standby events must not advance playback");
  f.finish(second);
  assert.equal(f.active(), first);
  assert.match(first.src, /call-2\.m4a$/);
  first.emit("pause");
  assert.equal(f.get("play").textContent, "Pause", "a queued pause from an earlier clip must not change the playing state");
  f.get("play").click();
  first.emit("play");
  assert.equal(f.get("play").textContent, "Play", "a queued play must not change the paused state");
  f.get("seek").value = 3;
  f.get("seek").emit("input");
  // Metadata for this active clip arrives after its preload was cleared.
  first.duration = 8;
  first.emit("loadedmetadata");
  f.get("seek").emit("input");
  assert.equal(first.currentTime, 3);
  f.get("play").click();
  assert.equal(f.active(), first);
});

test("autoplay off does not preload or advance, and toggling it off cancels the pending clip", async () => {
  const f = await playerFixture();
  f.select(0);
  assert.equal(f.players[1].src, null);
  f.get("autoplay").click();
  assert.match(f.players[1].src, /call-1\.m4a$/);
  f.get("autoplay").click();
  assert.equal(f.players[1].src, null);
  f.finish(f.players[0]);
  assert.equal(f.active(), undefined);
});

test("jumping to a different clip cancels the previous preload; the last clip ends normally", async () => {
  const f = await playerFixture();
  f.get("autoplay").click();
  f.select(0);
  f.select(2);
  assert.match(f.active().src, /call-2\.m4a$/);
  assert.match(f.players.find(player => player.paused).src, /call-3\.m4a$/);
  f.finish(f.active());
  assert.match(f.active().src, /call-3\.m4a$/);
  assert.equal(f.players.find(player => player.paused).src, null);
  f.finish(f.active());
  assert.equal(f.active(), undefined);
});

test("changing days clears both players and cannot reuse a clip from the old day", async () => {
  const f = await playerFixture();
  f.get("autoplay").click();
  f.select(0);
  f.get("day").value = "2026-09-10";
  f.get("day").emit("change");
  assert.ok(f.players.every(player => player.paused && !player.src));
  await new Promise(resolve => setImmediate(resolve));
  f.select(0);
  assert.match(f.active().src, /2026-09-10\/call-0\.m4a$/);
  assert.match(f.players.find(player => player.paused).src, /2026-09-10\/call-1\.m4a$/);
});

test("a failed standby download falls back to loading the next clip normally", async () => {
  const f = await playerFixture();
  f.get("autoplay").click();
  f.select(0);
  const first = f.active();
  f.players[1].error = { code: 2 };
  f.players[1].emit("error");
  assert.equal(f.get("player-message").textContent, "");
  f.finish(first);
  assert.equal(f.active(), first);
  assert.match(first.src, /call-1\.m4a$/);
});

test("a rejected play request from a previous selection cannot overwrite the new clip's status", async () => {
  const f = await playerFixture();
  const first = f.players[0];
  let reject;
  first.play = () => new Promise((_, fail) => { reject = fail; });
  f.select(0);
  first.play = Element.prototype.play;
  f.select(1);
  reject(new Error("Previous selection failed"));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.get("player-message").textContent, "");
  assert.match(f.active().src, /call-1\.m4a$/);
});


test("September 18 autoplay survives a rejected handoff within the first ten clips", async () => {
  const manifest = JSON.parse(readFileSync(new URL("../public/records/openmhz/openmhz-afpd-car-to-car-2026-09-18/calls.json", import.meta.url), "utf8"));
  const calls = manifest.calls.sort((a, b) => a.epoch - b.epoch).slice(0, 20);
  const f = await playerFixture(calls);
  const [first, second] = f.players;
  let rejected = false;
  second.play = function () {
    if (this.src.endsWith(calls[9].original_filename)) {
      rejected = true;
      return Promise.reject(Object.assign(new Error("Playback permission belongs to another element"), { name: "NotAllowedError" }));
    }
    return Element.prototype.play.call(this);
  };
  f.get("autoplay").click();
  f.select(0);
  for (let i = 0; i < calls.length; i++) {
    await new Promise(resolve => setImmediate(resolve));
    const player = f.active();
    assert.ok(player, `clip ${i + 1} must be playing`);
    assert.ok(player.src.endsWith(calls[i].original_filename));
    assert.equal(f.get("player-message").textContent, "");
    if (i >= 9) assert.equal(player, first, "retain the permitted player after recovery");
    f.finish(player);
  }
  assert.equal(rejected, true);
  assert.equal(f.active(), undefined, "stop normally at the end of the sequence");
});


test("staging uses one element for autoplay, clip jumps, pause, and day reset", async () => {
  const f = await playerFixture(undefined, "staging-afpd-tracker.ericseamonsdeveloper.workers.dev");
  assert.equal(f.players.length, 1, "no standby audio element should be created");
  const player = f.players[0];
  f.get("autoplay").click(); f.select(0);
  for (let i = 1; i < 4; i++) {
    f.finish(player);
    assert.equal(f.active(), player);
    assert.match(player.src, new RegExp(`call-${i}\\.m4a$`));
  }
  f.select(1);
  assert.equal(f.active(), player);
  assert.match(player.src, /call-1\.m4a$/);
  f.get("play").click();
  assert.equal(player.paused, true);
  f.get("play").click();
  assert.equal(f.active(), player);
  f.get("autoplay").click();
  f.finish(player);
  assert.match(player.src, /call-1\.m4a$/, "autoplay off must not advance");
  f.get("day").value = "2026-09-10"; f.get("day").emit("change");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(player.src, null);
  assert.equal(player.paused, true);
  f.select(0);
  assert.equal(f.active(), player);
  assert.match(player.src, /2026-09-10\/call-0\.m4a$/);
});

test("staging prefetches the September 18 problem sequence on one player and survives a backward jump", async () => {
  const manifest = JSON.parse(readFileSync(new URL("../public/records/openmhz/openmhz-afpd-car-to-car-2026-09-18/calls.json", import.meta.url), "utf8"));
  const calls = manifest.calls.sort((a, b) => a.epoch - b.epoch).slice(0, 15);
  const f = await playerFixture(calls, "staging-afpd-tracker.ericseamonsdeveloper.workers.dev", "2026-09-18");
  const player = f.players[0];
  f.get("autoplay").click();
  f.select(3);
  await f.settle();
  for (let index = 4; index <= 7; index++) {
    assert.ok(f.fetchedAudio.at(-1).endsWith(calls[index].original_filename));
    f.finish(player);
    assert.equal(f.active(), player);
    assert.ok(f.sourceFor(player).endsWith(calls[index].original_filename));
    await f.settle();
  }
  assert.match(f.get("current").textContent, /5:08:32 AM · Clip 8$/);

  f.select(5);
  assert.equal(f.active(), player);
  assert.ok(f.sourceFor(player).endsWith(calls[5].original_filename));
  assert.match(f.get("current").textContent, /5:08:10 AM · Clip 6$/);
  await f.settle();
  f.finish(player);
  assert.match(f.get("current").textContent, /5:08:26 AM · Clip 7$/);
  await f.settle();
  f.finish(player);
  assert.match(f.get("current").textContent, /5:08:32 AM · Clip 8$/);
  assert.equal(f.players.length, 1);
  assert.equal(f.get("player-message").textContent, "");
  assert.ok(f.revokedUrls.length > 0, "consumed Blob URLs should be released");
});

test("production uses one player and falls back to the original clip URL when byte prefetching fails", async () => {
  const f = await playerFixture(undefined, "afpd-accountability.com");
  assert.equal(f.players.length, 1, "production should use the tested single-player path");
  const player = f.players[0];
  f.failedAudio.add("/records/openmhz/2026-09-11/call-1.m4a");
  f.get("autoplay").click();
  f.select(0);
  await f.settle();
  f.finish(player);
  assert.equal(f.active(), player);
  assert.match(player.src, /2026-09-11\/call-1\.m4a$/);
  assert.equal(f.get("player-message").textContent, "");
});

test("missing, invalid, and unavailable date links select and expose the latest available day", async () => {
  for (const search of ["", "?date=nonsense", "?date=2026-02-30", "?date=2026-09-09"]) {
    const f = await playerFixture(undefined, undefined, "2026-10-19", search);
    assert.equal(f.get("month").value, "2026-10");
    assert.equal(f.get("day").value, "2026-10-19");
    assert.equal(f.window.location.search, "?date=2026-10-19");
    assert.match(f.get("status").textContent, /October 19, 2026/);
    assert.equal(f.replacements.length, 1);
    assert.equal(f.window.history.state.preserved, true);
    assert.equal(f.active(), undefined);
  }
});

test("a shared older date selects its month and clips without rewriting a valid URL", async () => {
  const f = await playerFixture(undefined, undefined, "2026-10-19", "?date=2026-09-10&other=keep#clips");
  assert.equal(f.get("month").value, "2026-09");
  assert.equal(f.get("day").value, "2026-09-10");
  assert.match(f.get("status").textContent, /September 10, 2026/);
  assert.equal(f.replacements.length, 0);
  f.select(0);
  assert.match(f.active().src, /2026-09-10\/call-0\.m4a$/);
});

test("month and day changes update the URL while retaining other parameters and the fragment", async () => {
  const f = await playerFixture(undefined, undefined, "2026-10-19", "?other=keep#clips");
  f.get("month").value = "2026-09";
  f.get("month").emit("change");
  await f.settle();
  assert.equal(f.get("day").value, "2026-09-10");
  assert.equal(f.window.location.searchParams.get("date"), "2026-09-10");
  f.get("month").value = "2026-10";
  f.get("month").emit("change");
  await f.settle();
  assert.equal(f.window.location.searchParams.get("date"), "2026-10-19");
  assert.equal(f.window.location.searchParams.get("other"), "keep");
  assert.equal(f.window.location.hash, "#clips");
  assert.equal(f.active(), undefined);
  const sameMonth = await playerFixture();
  sameMonth.get("day").value = "2026-09-10";
  sameMonth.get("day").emit("change");
  await sameMonth.settle();
  assert.equal(sameMonth.window.location.search, "?date=2026-09-10");
});


test("radio IDs appear in clip rows and player, and disappear for missing IDs and day resets", async () => {
  const calls = [
    { epoch: 1789100000, displayed_seconds: 5, original_filename: "one.m4a", radio_ids: ["14590123"], srcList: [{ src: 14590123 }] },
    { epoch: 1789100010, displayed_seconds: 5, original_filename: "two.m4a", srcList: [{ src: "14590123" }, { src: "14590107" }] },
    { epoch: 1789100020, displayed_seconds: 5, original_filename: "none.m4a" },
    { epoch: 1789100030, displayed_seconds: 5, original_filename: "invalid.m4a", radio_ids: [0, -1, "", null] }
  ];
  const f = await playerFixture(calls, undefined, "2026-09-11", "", false);
  const row = i => f.get("clips").children[i].children[0];
  assert.equal(f.get("current-radio-ids").hidden, true);
  assert.equal(f.get("clips").children[0].children[1].textContent, "Radio ID: 14590123");
  assert.match(row(0).getAttribute("aria-label"), /Radio ID: 14590123/);
  assert.equal(f.get("clips").children[1].children[1].textContent, "Radio IDs: 14590123, 14590107");
  for (const i of [2, 3]) {
    assert.equal(row(i).children[0].children.length, 2, "no additional row content without a valid ID");
    assert.doesNotMatch(row(i).getAttribute("aria-label"), /Radio ID/);
  }
  f.select(0);
  assert.equal(f.get("current-radio-ids").textContent, "Radio ID: 14590123");
  assert.equal(f.get("current-radio-ids").hidden, false);
  assert.equal(f.get("transcript").hidden, true, "IDs do not depend on transcript visibility");
  f.select(1);
  assert.equal(f.get("current-radio-ids").textContent, "Radio IDs: 14590123, 14590107");
  f.select(2);
  assert.equal(f.get("current-radio-ids").hidden, true);
  assert.equal(f.get("current-radio-ids").textContent, "");
  f.select(0);
  f.get("day").value = "2026-09-10";
  f.get("day").emit("change");
  await f.settle();
  assert.equal(f.get("current-radio-ids").hidden, true);
  assert.equal(f.get("current-radio-ids").textContent, "");
});


test("confirmed names follow the date in rows, accessible labels and the player", async () => {
  const calls = [
    { epoch: 1789100000, displayed_seconds: 5, original_filename: "known.m4a", radio_ids: ["14590098"] },
    { epoch: 1789100010, displayed_seconds: 5, original_filename: "mixed.m4a", radio_ids: ["14590098", "14590026"] }
  ];
  const associations = { schema_version: 2, days: {
    "2026-09-11": { "14590098": { name: "Greg B. Mecham", status: "confirmed", evidence_days: 10 } },
    "2026-09-10": { "14590026": { name: "Different dated association", status: "single-day", evidence_days: 1 } }
  } };
  const f = await playerFixture(calls, undefined, "2026-09-11", "", true, associations);
  const row = i => f.get("clips").children[i].children[0];
  const ids = f.get("clips").children[0].children[1];
  assert.equal(ids.children[1].children[1].textContent, " · Greg B. Mecham");
  assert.equal(ids.children[1].children[2].textContent, " · Confirmed this day");
  assert.equal(ids.children[1].children[0].tag, "strong");
  assert.match(row(0).getAttribute("aria-label"), /Greg B. Mecham/);
  assert.match(row(1).getAttribute("aria-label"), /14590098 · Greg B. Mecham · Confirmed this day, 14590026/);
  f.select(0);
  assert.equal(f.get("current-radio-ids").textContent, ids.textContent);
  f.get("day").value = "2026-09-10";
  f.get("day").emit("change");
  await f.settle();
  assert.equal(f.get("current-radio-ids").hidden, true);
  assert.equal(f.get("clips").children[0].children[1].textContent, "Radio ID: 14590098");
  f.select(1);
  assert.match(f.get("current-radio-ids").textContent, /14590026 · Different dated association · Single-day association/);
});

test("missing or invalid associations leave IDs bold and playback available", async () => {
  for (const associations of [null, { schema_version: 99, days: {} }, new Error("Unavailable")]) {
    const f = await playerFixture([
      { epoch: 1789100000, displayed_seconds: 5, original_filename: "known.m4a", radio_ids: ["14590098"] }
    ], undefined, "2026-09-11", "", true, associations);
    f.select(0);
    const ids = f.get("current-radio-ids");
    assert.equal(ids.textContent, "Radio ID: 14590098");
    assert.equal(ids.children[1].children[0].tag, "strong");
    assert.ok(f.active());
  }
});

test("curated dated labels include corrections and omit uncertain associations", () => {
  const { days } = JSON.parse(readFileSync(new URL("../public/records/openmhz/officer-associations.json", import.meta.url), "utf8"));
  assert.equal(days["2026-09-12"]["14590105"].name, "Kelepi Makai");
  assert.equal(days["2026-10-07"]["14590268"].name, "Samuel Canizalez");
  assert.equal(days["2026-09-24"]["14590100"].name, "Sammantha J. Halladay");
  assert.equal(days["2026-10-24"]["14590165"].name, "Ivan R. Bird");
  assert.equal(days["2026-10-24"]["14590313"].name, "Delton L. Choates");
  assert.equal(days["2026-10-25"]["14590313"], undefined, "possible contradictory hail holds this date");
  assert.equal(days["2026-09-19"]["14590100"], undefined);
  assert.equal(days["2026-10-01"]["14590247"].status, "strong");
  assert.equal(days["2026-10-27"]["14590023"].name, "David O. Guerra");
  assert.equal(days["2026-10-27"]["14590023"].status, "confirmed");
  assert.deepEqual(days["2026-10-27"]["14590023"].confirmed_dates, ["2026-10-27"]);
  assert.equal(days["2026-10-28"]?.["14590023"], undefined, "confirmation does not carry to other dates");
  for (const ids of Object.values(days)) {
    assert.equal(ids["14590045"], undefined);
    assert.equal(ids["14590221"], undefined);
    for (const [id, entry] of Object.entries(ids)) {
      assert.match(id, /^[1-9]\d*$/);
      assert.ok(entry.name && entry.status && entry.evidence_dates.length);
    }
  }
});

test("association information opens by hover, focus and tap without playing the clip", async () => {
  const f = await playerFixture([
    { epoch: 1789100000, displayed_seconds: 5, original_filename: "known.m4a", radio_ids: ["14590098"] }
  ], undefined, "2026-09-11", "", true, { schema_version: 2, days: {
    "2026-09-11": { "14590098": { name: "Greg B. Mecham", status: "strong", evidence_days: 10, evidence_dates: ["2026-09-12"] } }
  } });
  const identity = f.get("clips").children[0].children[1];
  const info = identity.children[1].children[3];
  const [button, popup] = info.children;
  assert.equal(popup.hidden, true);
  assert.equal(popup.children[1].href, "/police-radio-resources/#radio-id-14590098");
  info.emit("mouseenter");
  assert.equal(popup.hidden, false);
  assert.match(popup.textContent, /on 10 dates/);
  assert.match(popup.textContent, /not been confirmed for September 11/);
  info.emit("mouseleave");
  assert.equal(popup.hidden, true);
  button.focus();
  assert.equal(button.getAttribute("aria-expanded"), "true");
  button.click();
  info.emit("mouseleave");
  assert.equal(popup.hidden, false, "tap pins the information open");
  info.emit("keydown", { key: "Escape" });
  assert.equal(popup.hidden, true, "Escape must not reopen on focus");
  button.click();
  assert.equal(popup.hidden, false);
  button.click();
  assert.equal(popup.hidden, true);
  assert.equal(f.active(), undefined, "information controls do not start playback");
});

test("every 6001 day is screened and fallback names respect holds and single-day limits", () => {
  const data = JSON.parse(readFileSync(new URL("../public/records/openmhz/officer-associations.json", import.meta.url), "utf8"));
  const review = JSON.parse(readFileSync(new URL("../findings/2026-10-27-radio-officer-label-review.json", import.meta.url), "utf8"));
  assert.equal(review.coverage.length, 48, "historical screening covers 48 days; later owner confirmations may add dates");
  assert.equal(review.coverage.reduce((sum, day) => sum + day.transcripts_screened, 0), 12298);
  for (const day of review.coverage) {
    for (const id of day.held_ids) assert.equal(data.days[day.date][id], undefined);
    for (const entry of Object.values(data.days[day.date])) {
      if (entry.status === "strong") assert.ok(entry.evidence_days >= 2);
      if (entry.status === "single-day") assert.deepEqual(entry.evidence_dates, [day.date]);
    }
  }
  assert.equal(data.days["2026-09-12"]["14590020"].status, "strong");
  assert.equal(data.days["2026-10-20"]["14590100"], undefined);
  assert.equal(data.days["2026-10-03"]["14580151"], undefined);
  assert.equal(data.days["2026-10-20"]["14590165"], undefined);
});

test("download link follows the loaded date and hides when transcripts are disabled", async () => {
  const f = await playerFixture(undefined, undefined, "2026-10-21", "", date => date !== "2026-09-10");
  const link = f.get("transcript-download");
  assert.equal(link.hidden, false);
  assert.equal(link.getAttribute("download"), "afpd-car-to-car-transcript-2026-10-21.txt");
  assert.equal(link.getAttribute("href"), "/records/openmhz/2026-10-21/afpd-car-to-car-transcript-2026-10-21.txt");
  assert.equal(f.get("transcript-toggle").hidden, false);
  f.get("day").value = "2026-09-10";
  f.get("day").emit("change");
  assert.equal(link.hidden, true);
  assert.equal(link.getAttribute("href"), null);
  await f.settle();
  assert.equal(link.hidden, true);
  assert.equal(link.getAttribute("download"), null);
  assert.equal(link.getAttribute("href"), null);
  assert.equal(f.get("transcript-toggle").hidden, true);
  f.get("day").value = "2026-10-21";
  f.get("day").emit("change");
  await f.settle();
  assert.equal(link.hidden, false);
  assert.equal(link.getAttribute("download"), "afpd-car-to-car-transcript-2026-10-21.txt");
  assert.equal(link.getAttribute("href"), "/records/openmhz/2026-10-21/afpd-car-to-car-transcript-2026-10-21.txt");
  f.get("day").value = "unavailable";
  f.get("day").emit("change");
  await f.settle();
  assert.equal(link.hidden, true);
  assert.equal(link.getAttribute("href"), null);
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
  assert.equal(transcribed.textContent, "2 / 6");
  assert.equal(verified.textContent, "1 / 6");
  assert.equal(progress.hidden, false);
  calls[0].validated = false;
  calls[1].transcript = "";
  f.get("day").value = "2026-09-10";
  f.get("day").emit("change");
  assert.equal(progress.hidden, true);
  assert.equal(transcribed.textContent, "");
  assert.equal(verified.textContent, "");
  await f.settle();
  assert.equal(transcribed.textContent, "1 / 6");
  assert.equal(verified.textContent, "0 / 6");
  assert.equal(progress.hidden, false);
});

test("an empty day displays zero out of zero for both progress counts", async () => {
  const f = await playerFixture([]);
  assert.equal(f.get("transcription-count").textContent, "0 / 0");
  assert.equal(f.get("verification-count").textContent, "0 / 0");
});
