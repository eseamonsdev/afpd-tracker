import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";

function fixture() {
  class Element {
    constructor() { this.attrs = new Map(); this.events = new Map(); this.style = {}; this.paused = true; this.duration = NaN; }
    addEventListener(name, handler) { const handlers = this.events.get(name) || []; handlers.push(handler); this.events.set(name, handlers); }
    emit(name, event = {}) { for (const handler of this.events.get(name) || []) handler(event); }
    setAttribute(key, value) { this.attrs.set(key, String(value)); }
    getAttribute(key) { return this.attrs.get(key) ?? null; }
    hasAttribute(key) { return this.attrs.has(key); }
    removeAttribute(key) { this.attrs.delete(key); }
    set src(value) { this.setAttribute("src", value); }
    load() {}
    pause() { this.paused = true; this.emit("pause"); }
    play() { this.paused = false; this.emit("play"); return Promise.resolve(); }
  }
  const window = new Element();
  Object.assign(window, { scrollX: 0, scrollY: 0, innerHeight: 800 });
  const panel = { offsetHeight: 150, getBoundingClientRect: () => ({ bottom: 170 }) };
  const elements = new Map(["audio", "play", "seek", "autoplay", "show-current", "current", "player-message", "elapsed", "duration"].map(name => [name, new Element()]));
  elements.get("show-current").closest = () => panel;
  const buttons = [new Element(), new Element()];
  for (const button of buttons) {
    button.bounds = { top: 1200, bottom: 1250 };
    button.getBoundingClientRect = () => button.bounds;
    button.scrolls = 0;
    button.scrollIntoView = options => { assert.equal(options.behavior, "instant"); button.scrolls++; window.scrollY += 500; };
  }
  const context = vm.createContext({ window, AbortController, fetch: async () => ({ ok: false }) });
  const source = readFileSync("public/js/radio-player-core.js", "utf8").replace("globalThis.RadioPlayer = {", "globalThis.RadioPlayer = { playbackEngine,");
  vm.runInContext(source, context);
  const engine = context.RadioPlayer.playbackEngine({ get: name => elements.get(name), getCalls: () => [{}, {}], getButtons: () => buttons, clipSource: i => `/clip-${i}.m4a`, label: i => `Clip ${i}`, onSelect() {} });
  const toggle = elements.get("show-current"), audio = elements.get("audio");
  return { engine, window, buttons, audio, toggle, autoplay: elements.get("autoplay"), play: elements.get("play") };
}

test("follow toggles, ignores its own scroll, and follows autoplay without pausing audio", () => {
  const f = fixture();
  f.engine.choose(0);
  assert.equal(f.buttons[0].scrolls, 0);
  f.toggle.emit("click");
  assert.equal(f.toggle.getAttribute("aria-pressed"), "true");
  assert.equal(f.buttons[0].scrolls, 1);
  f.window.emit("scroll");
  assert.equal(f.toggle.getAttribute("aria-pressed"), "true");
  f.autoplay.emit("click");
  f.audio.ended = true; f.audio.paused = true; f.audio.emit("ended");
  assert.equal(f.engine.selected, 1);
  assert.equal(f.buttons[1].scrolls, 1);
  f.toggle.emit("click");
  assert.equal(f.toggle.getAttribute("aria-pressed"), "false");
  assert.equal(f.audio.paused, false);
  f.engine.choose(0);
  assert.equal(f.buttons[0].scrolls, 1);
});

test("manual scrolling opts out without pausing, and requires explicit re-enabling", () => {
  for (const input of ["wheel", "touchmove", "keydown", "scroll"]) {
    const f = fixture(); f.engine.choose(0); f.toggle.emit("click");
    if (input === "scroll") f.window.scrollY += 50;
    f.window.emit(input, { key: "PageDown" });
    assert.equal(f.toggle.getAttribute("aria-pressed"), "false", input);
    assert.equal(f.audio.paused, false, input);
    f.engine.choose(1);
    assert.equal(f.buttons[1].scrolls, 0, input);
    f.toggle.emit("click");
    assert.equal(f.buttons[1].scrolls, 1, input);
  }
});

test("visible clips stay in place, pause retains follow, and resetting clears it", () => {
  const f = fixture(); f.buttons[0].bounds = { top: 250, bottom: 300 };
  f.engine.choose(0); f.toggle.emit("click");
  assert.equal(f.buttons[0].scrolls, 0);
  f.play.emit("click");
  assert.equal(f.audio.paused, true);
  assert.equal(f.toggle.getAttribute("aria-pressed"), "true");
  f.window.emit("keydown", { key: "ArrowDown", target: { closest: () => ({}) } });
  assert.equal(f.toggle.getAttribute("aria-pressed"), "true", "control keyboard input does not opt out");
  f.engine.reset();
  assert.equal(f.toggle.getAttribute("aria-pressed"), "false");
  assert.equal(f.toggle.disabled, true);
});
