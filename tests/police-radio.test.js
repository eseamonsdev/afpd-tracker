import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../public/js/police-radio.js", import.meta.url), "utf8");

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
  emit(name) { for (const handler of this.listeners.get(name) ?? []) handler(); }
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
  after(element) { this.sibling = element; }
  append(...children) {
    for (const child of children) this.children.push(...(child.tag === "fragment" ? child.children : [child]));
  }
  replaceChildren(...children) { this.children = children; this.options = []; this.value = ""; }
  add(option) { this.options.push(option); if (this.options.length === 1) this.value = option.value; }
}

async function playerFixture(fixtureCalls, hostname) {
  const elements = new Map(["archive", "month", "day", "audio", "play", "seek", "autoplay",
    "clips", "clips-section", "status", "current", "player-message", "elapsed", "duration"]
    .map(name => [`radio-${name}`, new Element(name === "audio" ? "audio" : "div")]));
  const players = [elements.get("radio-audio")];
  const dates = ["2026-09-11", "2026-09-10"];
  let now = Date.now();
  const timers = [];
  const windowListeners = new Map();
  const window = hostname ? { location: { hostname }, navigator: { userAgent: "iPhone test" },
    addEventListener: (name, handler) => windowListeners.set(name, handler),
    setInterval: handler => timers.push(handler) } : undefined;
  const document = {
    visibilityState: "visible",
    addEventListener: () => {},
    getElementById: id => elements.get(id),
    createDocumentFragment: () => new Element("fragment"),
    createElement(tag) {
      const element = new Element(tag);
      if (tag === "audio") players.push(element);
      return element;
    }
  };
  vm.runInNewContext(source, {
    document, window, Intl, Date: class extends Date { static now() { return now; } }, AbortController,
    Option: class { constructor(text, value) { this.text = text; this.value = value; } },
    fetch: async url => ({ ok: true, json: async () => url.endsWith("index.json")
      ? { days: dates.map(date => ({ date, folder: date, count: fixtureCalls?.length ?? 4 })) }
      : { date: dates.find(date => url.includes(date)), calls: fixtureCalls ?? Array.from({ length: 4 }, (_, i) => ({
        epoch: 1789100000 + i * 10, displayed_seconds: 5, original_filename: `call-${i}.m4a`
      })) } })
  });
  await new Promise(resolve => setImmediate(resolve));
  const get = name => elements.get(`radio-${name}`);
  const select = i => get("clips").children[i].children[0].click();
  const active = () => players.find(player => !player.paused);
  const finish = player => { player.ended = true; player.paused = true; player.emit("ended"); };
  const debug = () => get("archive").children.find(el => el.id === "radio-debug-panel");
  const diagnostic = () => JSON.parse(debug().children[2].value);
  return { get, select, players, active, finish, debug, diagnostic,
    advance: ms => { now += ms; timers.forEach(handler => handler()); }, windowListeners };
}

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


test("diagnostics are disabled on production, even with the same player code", async () => {
  const f = await playerFixture(undefined, "afpd-accountability.com");
  assert.equal(f.debug(), undefined);
});

test("staging reports a rejected play request without changing playback state", async () => {
  const f = await playerFixture(undefined, "afpd-tracker.ericseamonsdeveloper.workers.dev");
  f.players[0].play = () => Promise.reject(Object.assign(new Error("Not allowed on this element"), { name: "NotAllowedError" }));
  f.select(0);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.debug().hidden, false);
  assert.equal(f.diagnostic().reason, "Play request rejected");
  assert.equal(f.diagnostic().history.at(-1).name, "NotAllowedError");
  assert.match(f.diagnostic().players[0].file, /call-0.m4a$/);
});

test("staging detects playback stuck without an error and distinguishes loading", async () => {
  const f = await playerFixture(undefined, "afpd-tracker.ericseamonsdeveloper.workers.dev");
  f.get("autoplay").click(); f.select(0);
  f.advance(14000);
  assert.equal(f.diagnostic().reason, "Playback time stopped progressing for 12 seconds");
  assert.equal(f.diagnostic().autoplay, true);
  assert.equal(f.active(), f.players[0], "diagnostics must not pause or skip clips");
  f.select(1); f.active().readyState = 1;
  f.advance(14000);
  assert.equal(f.diagnostic().reason, "Playback waiting for audio data for 12 seconds");
});

test("staging detects unexpected pause and missing end event, but ignores intentional pauses", async () => {
  const f = await playerFixture(undefined, "afpd-tracker.ericseamonsdeveloper.workers.dev");
  f.get("autoplay").click(); f.select(0); f.active().pause();
  f.advance(14000);
  assert.equal(f.diagnostic().reason, "Unexpected pause while playback was requested");
  f.select(1); f.active().ended = true; f.active().paused = true;
  f.advance(14000);
  assert.equal(f.diagnostic().reason, "Clip ended but autoplay did not advance");
  f.select(2); f.debug().hidden = true; f.get("play").click();
  f.advance(14000);
  assert.equal(f.debug().hidden, true);
});

test("staging records media and global errors, while completed sequences do not trigger a popup", async () => {
  const f = await playerFixture(undefined, "afpd-tracker.ericseamonsdeveloper.workers.dev");
  f.select(0); f.active().error = { code: 3, message: "Decode error" }; f.active().emit("error");
  assert.equal(f.diagnostic().reason, "Active media error");
  assert.equal(f.diagnostic().players[0].error.code, 3);
  f.windowListeners.get("error")({ message: "Unexpected JS error", filename: "police-radio.js", lineno: 99 });
  assert.equal(f.diagnostic().reason, "JavaScript error");
  f.windowListeners.get("unhandledrejection")({ reason: new Error("Unhandled failure") });
  assert.equal(f.diagnostic().reason, "Unhandled promise rejection");
  f.get("autoplay").click(); f.select(3); f.debug().hidden = true; f.finish(f.active());
  f.advance(14000);
  assert.equal(f.debug().hidden, true, "end of day is not a stall");
});
