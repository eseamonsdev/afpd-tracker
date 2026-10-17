import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { buildRadioExcerpt } from "../lib/build-radio-excerpt.js";

const entity = JSON.parse(readFileSync("data/entities/police-radio-excerpts/1.json", "utf8")).entities[0];
const source = readFileSync("public/js/police-radio-excerpt.js", "utf8");
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
  after(...elements) { this.sibling = elements[0]; this.afterElements = elements; }
  append(...children) {
    for (const child of children) this.children.push(...(child.tag === "fragment" ? child.children : [child]));
  }
  replaceChildren(...children) { this.children = children; this.options = []; this.value = ""; }
  add(option) { this.options.push(option); if (this.options.length === 1) this.value = option.value; }
}


async function fixture() {
  const elements = new Map(["audio", "play", "seek", "autoplay", "show-current", "current", "player-message", "elapsed", "duration"].map(name => [name, new Element()]));
  const excerpt = buildRadioExcerpt(entity);
  const buttons = excerpt.sections.flatMap(s => s.ranges.flatMap(r => r.calls)).map(call => {
    const button = new Element();
    button.dataset = { source: call.source, seconds: String(call.seconds), label: `Clip ${call.number}` };
    return button;
  });
  const root = { querySelector: id => elements.get(id.replace("#excerpt-", "")), querySelectorAll: () => buttons };
  const objectSources = new Map(), failed = new Set(), revoked = [];
  let serial = 0;
  vm.runInNewContext(source, {
    document: { getElementById: id => id === "radio-excerpt" ? root : null },
    window: { addEventListener() {} }, AbortController,
    URL: { createObjectURL(blob) { const url = `blob:${++serial}`; objectSources.set(url, blob.source); return url; }, revokeObjectURL(url) { revoked.push(url); } },
    fetch: async url => ({ ok: !failed.has(url), blob: async () => ({ source: url }) })
  });
  const get = name => elements.get(name), audio = get("audio");
  return { get, audio, buttons, failed, revoked,
    select: i => buttons[i].click(),
    finish: () => { audio.ended = true; audio.paused = true; audio.emit("ended"); },
    source: () => objectSources.get(audio.src) || audio.src,
    settle: () => new Promise(resolve => setImmediate(resolve)) };
}

test("starter selects the intended calls and retains original archive numbering", () => {
  const excerpt = buildRadioExcerpt(entity);
  const numbers = excerpt.sections.flatMap(s => s.ranges.flatMap(r => r.calls.map(c => c.number)));
  assert.equal(excerpt.total, 159);
  assert.equal(excerpt.duration, "8 min 4 sec");
  assert.deepEqual(numbers, [...Array.from({length:66},(_,i)=>i+58), ...Array.from({length:34},(_,i)=>i+130), ...Array.from({length:59},(_,i)=>i+172)]);
});

test("multiple ranges, single calls and optional headings work; bad ranges fail closed", () => {
  const copy = structuredClone(entity);
  copy.sections = [{ ranges: entity.sections.flatMap(s => s.ranges) }];
  assert.equal(buildRadioExcerpt(copy).total,159);
  copy.sections[0].ranges = [{...copy.sections[0].ranges[0]}];
  delete copy.sections[0].ranges[0].last;
  assert.equal(buildRadioExcerpt(copy).total,1);
  copy.sections[0].ranges.push({...copy.sections[0].ranges[0]});
  assert.throws(()=>buildRadioExcerpt(copy), /overlapping/);
  copy.sections[0].ranges = [{...entity.sections[0].ranges[0], first:"missing.m4a"}];
  assert.throws(()=>buildRadioExcerpt(copy), /boundary/);
  copy.sections[0].ranges = [{...entity.sections[0].ranges[0], first:entity.sections[0].ranges[0].last,last:entity.sections[0].ranges[0].first}];
  assert.throws(()=>buildRadioExcerpt(copy), /boundary/);
});

test("autoplay defaults off; selected calls cross section gaps on the same audio element", async () => {
  const f = await fixture();
  assert.equal(f.audio.src,null);
  f.select(65); f.finish();
  assert.match(f.get("current").textContent,/Clip 123$/);
  f.get("autoplay").click(); f.select(65); await f.settle(); f.finish();
  assert.match(f.get("current").textContent,/Clip 130$/);
  assert.equal(f.audio.paused,false);
  f.select(99); await f.settle(); f.finish();
  assert.match(f.get("current").textContent,/Clip 172$/);
  f.select(158); f.finish();
  assert.equal(f.get("player-message").textContent,"End of excerpt.");
  assert.equal(f.audio.paused,true);
});

test("pause, seek, jumps, preload failure and autoplay cancellation", async () => {
  const f = await fixture();
  f.failed.add(f.buttons[1].dataset.source);
  f.get("autoplay").click(); f.select(0); await f.settle(); f.finish();
  assert.equal(f.source(),f.buttons[1].dataset.source);
  f.audio.duration = 10; f.audio.emit("loadedmetadata");
  f.get("seek").value=4; f.get("seek").emit("input");
  assert.equal(f.audio.currentTime,4);
  f.get("play").click(); assert.equal(f.audio.paused,true);
  f.get("play").click(); assert.equal(f.audio.paused,false);
  f.select(10); await f.settle(); f.select(3); await f.settle();
  assert.equal(f.source(),f.buttons[3].dataset.source);
  f.get("autoplay").click(); f.finish();
  assert.equal(f.source(),f.buttons[3].dataset.source);
  assert.ok(f.revoked.length);
});

test("stale playback failures cannot overwrite a new selection", async () => {
  const f = await fixture();
  let reject;
  f.audio.play = () => new Promise((_,fail)=>{reject=fail;});
  f.select(0); f.audio.play = Element.prototype.play; f.select(1);
  reject(new Error("old request")); await f.settle();
  assert.equal(f.get("player-message").textContent,"");
});
