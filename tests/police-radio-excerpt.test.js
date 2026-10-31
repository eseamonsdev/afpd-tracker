import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { buildRadioExcerpt } from "../lib/build-radio-excerpt.js";

const entity = JSON.parse(readFileSync("data/entities/police-radio-excerpts/1.json", "utf8")).entities[0];
const source = readFileSync("public/js/radio-player-core.js", "utf8") + "\n" + readFileSync("public/js/police-radio-excerpt.js", "utf8");
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


async function fixture(withTranscription = true) {
  const elements = new Map(["audio", "play", "seek", "autoplay", "show-current", "current", "player-message", "elapsed", "duration"].map(name => [name, new Element()]));
  if (withTranscription) {
    elements.set("transcription-toggle", new Element());
    elements.set("transcription", new Element());
    elements.set("transcript-text", new Element());
    elements.set("transcript-status", new Element());
    elements.set("call-note", new Element());
    elements.set("call-note-text", new Element());
    elements.get("transcript-status").hidden = true;
    elements.get("call-note").hidden = true;
  }
  elements.set("current-radio-ids", new Element());
  elements.get("current-radio-ids").hidden = true;
  const excerpt = buildRadioExcerpt(entity);
  const buttons = excerpt.sections.flatMap(s => s.ranges.flatMap(r => r.calls)).map(call => {
    const button = new Element();
    button.dataset = { source: call.source, seconds: String(call.seconds), label: `Clip ${call.number}`,
      transcript: call.transcript, validated: String(call.validated), note: call.note, radioIds: call.radioIds };
    return button;
  });
  const root = { querySelector: id => elements.get(id.replace("#excerpt-", "")), querySelectorAll: () => buttons };
  const objectSources = new Map(), failed = new Set(), revoked = [];
  let serial = 0;
  vm.runInNewContext(source, {
    document: { createElementNS: (_, tag) => new Element(tag), getElementById: id => id === "radio-excerpt" ? root : null, createElement: tag => new Element(tag) },
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
  assert.deepEqual(excerpt.progress, [{ date: "09/12/2026", total: 159, transcribed: 159, verified: 159 }]);
  assert.deepEqual(numbers, [...Array.from({length:66},(_,i)=>i+58), ...Array.from({length:34},(_,i)=>i+130), ...Array.from({length:59},(_,i)=>i+172)]);
});

test("coverage counts only the selected excerpt clips and keeps verification separate", () => {
  const unverified = JSON.parse(readFileSync("data/entities/police-radio-excerpts/2.json", "utf8")).entities[0];
  assert.deepEqual(buildRadioExcerpt(unverified).progress, [{ date: "09/12/2026", total: 182, transcribed: 182, verified: 0 }]);
  const single = structuredClone(entity);
  single.sections = [{ ranges: [{ ...entity.sections[0].ranges[0] }] }];
  delete single.sections[0].ranges[0].last;
  assert.deepEqual(buildRadioExcerpt(single).progress, [{ date: "09/12/2026", total: 1, transcribed: 1, verified: 1 }]);
});

test("transcription is opt-in per excerpt and rejects invalid configuration", () => {
  const enabled = buildRadioExcerpt(entity);
  assert.ok(enabled.sections[0].ranges[0].calls[0].transcript.length);
  const disabled = buildRadioExcerpt({ ...entity, enableTranscription: false });
  assert.equal(disabled.sections[0].ranges[0].calls[0].transcript, "");
  assert.equal(disabled.progress[0].transcribed, 0);
  assert.equal(disabled.progress[0].verified, 159);
  assert.throws(() => buildRadioExcerpt({ ...entity, enableTranscription: "true" }), /must be a boolean/);
});

test("excerpt call metadata matches the daily archive, including missing IDs", () => {
  const enabled = buildRadioExcerpt(entity);
  const call = enabled.sections[0].ranges[0].calls[0];
  assert.match(call.radioIds, /^Radio ID: [1-9]\d*$/);
  assert.equal(call.validated, true);
  const all = Array.from({ length: 14 }, (_, i) => {
    const entry = JSON.parse(readFileSync(`data/entities/police-radio-excerpts/${i + 1}.json`, "utf8")).entities[0];
    assert.equal(entry.enableTranscription, true);
    return buildRadioExcerpt(entry).sections.flatMap(s => s.ranges.flatMap(r => r.calls));
  }).flat();
  assert.ok(all.some(c => !c.radioIds));
  assert.ok(all.some(c => !c.validated));
  assert.ok(all.every(c => c.transcript));
});

test("transcription follows selection and autoplay, handles missing text, and toggles off", async () => {
  const f = await fixture();
  const toggle = f.get("transcription-toggle"), panel = f.get("transcription");
  const text = f.get("transcript-text");
  assert.equal(panel.hidden, true);
  toggle.click();
  assert.equal(toggle.getAttribute("aria-pressed"), "true");
  assert.equal(panel.hidden, false);
  assert.match(text.textContent, /Choose a clip/);
  f.select(0);
  assert.equal(text.textContent, f.buttons[0].dataset.transcript);
  f.buttons[1].dataset.transcript = "  ";
  f.get("autoplay").click(); await f.settle(); f.finish();
  assert.equal(text.textContent, "[no transcript available]");
  assert.equal(f.get("transcript-status").hidden, true);
  f.buttons[2].dataset.transcript = '<script>alert("test")</script>';
  f.select(2);
  assert.equal(text.textContent, '<script>alert("test")</script>');
  assert.equal(text.children.length, 0, "transcripts remain plain text");
  toggle.click();
  assert.equal(panel.hidden, true);
  assert.equal(text.textContent, "");
  f.select(3);
  assert.equal(panel.hidden, true);
  toggle.click();
  assert.equal(text.textContent, f.buttons[3].dataset.transcript);
});

test("selected clip shows radio IDs, verification state, and a note only when present", async () => {
  const f = await fixture();
  const ids = f.get("current-radio-ids"), status = f.get("transcript-status");
  const note = f.get("call-note"), noteText = f.get("call-note-text");
  assert.equal(ids.hidden, true);
  f.get("transcription-toggle").click();
  f.buttons[0].dataset.note = "Audio checked; location unclear.";
  f.select(0);
  assert.equal(ids.textContent, f.buttons[0].dataset.radioIds);
  assert.equal(ids.hidden, false);
  assert.equal(status.textContent, "✓ Verified");
  assert.equal(status.getAttribute("data-verified"), "true");
  assert.equal(note.hidden, false);
  assert.equal(noteText.textContent, "Audio checked; location unclear.");
  f.buttons[1].dataset.radioIds = "";
  f.buttons[1].dataset.validated = "false";
  f.select(1);
  assert.equal(ids.hidden, true);
  assert.equal(ids.textContent, "");
  assert.equal(status.textContent, "AI-generated · Unverified");
  assert.equal(status.getAttribute("data-verified"), "false");
  assert.equal(note.hidden, true);
  f.get("transcription-toggle").click();
  assert.equal(status.hidden, true);
  assert.equal(noteText.textContent, "");
});

test("excerpts without transcription controls retain normal playback", async () => {
  const f = await fixture(false);
  f.select(0);
  assert.equal(f.audio.paused, false);
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
