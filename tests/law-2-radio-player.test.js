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

async function playerFixture(fixtureCalls, hostname, fixtureDate = "2026-09-11", search = "", transcriptEnabled = true, associations = null) {
  const elements = new Map(["archive", "month", "day", "audio", "play", "seek", "autoplay",
    "clips", "clips-section", "status", "current", "current-radio-ids", "player-message", "elapsed", "duration",
    "coverage", "transcript-toggle", "transcript-download", "transcript", "transcript-status", "transcript-text", "transcript-availability"]
    .map(name => [`law2-radio-${name}`, new Element(name === "audio" ? "audio" : "div")]));
  elements.get("law2-radio-autoplay").setAttribute("aria-pressed", "false");
  const players = [elements.get("law2-radio-audio")];
  const dates = [fixtureDate, "2026-09-10"];
  const fetchedAudio = [], revokedUrls = [], objectSources = new Map(), failedAudio = new Set();
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
    getElementById: id => elements.get(id),
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
        ? { days: dates.map(date => ({ date, folder: `openmhz-afpd-law-2-${date}`, enableDay: true, enableTranscription: typeof transcriptEnabled === "function" ? transcriptEnabled(date) : transcriptEnabled, count: fixtureCalls?.length ?? 4 })) }
        : { date: dates.find(date => url.includes(date)), enableTranscription: typeof transcriptEnabled === "function" ? transcriptEnabled(dates.find(date => url.includes(date))) : transcriptEnabled, calls: fixtureCalls ?? Array.from({ length: 4 }, (_, i) => ({
          epoch: 1789100000 + i * 10, displayed_seconds: 5, original_filename: `call-${i}.m4a`
        })) } };
    }
  });
  await new Promise(resolve => setImmediate(resolve));
  const get = name => elements.get(`law2-radio-${name}`);
  const select = i => get("clips").children[i].children[0].click();
  const active = () => players.find(player => !player.paused);
  const finish = player => { player.ended = true; player.paused = true; player.emit("ended"); };
  return { get, select, players, active, finish, fetchedAudio, revokedUrls, failedAudio, window, replacements,
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
