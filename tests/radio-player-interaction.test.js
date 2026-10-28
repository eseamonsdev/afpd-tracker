import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import nunjucks from "nunjucks";

const context = vm.createContext({ Intl, Date });
vm.runInContext(readFileSync("public/js/radio-player-core.js", "utf8"), context);

// Minimal bubbling DOM: exercise the hit area and interactive descendants,
// including clicks on text inside the playback button and the popup.
class Element {
  constructor(tag, className = "", parent = null) {
    Object.assign(this, { tag, className, parent, handlers: [] });
  }
  addEventListener(type, fn) { if (type === "click") this.handlers.push(fn); }
  closest(selectors) {
    const matches = selectors.split(",").map(x => x.trim());
    for (let node = this; node; node = node.parent) {
      if (matches.some(selector => selector.startsWith(".") ? node.className.split(" ").includes(selector.slice(1)) : node.tag === selector)) return node;
    }
    return null;
  }
  click() { for (let node = this; node; node = node.parent) for (const handler of node.handlers) handler({ target: this }); }
}

test("whole-row playback selects once and leaves info buttons, popup text and links independent", () => {
  const row = new Element("li"), button = new Element("button", "radio-clip", row);
  const label = new Element("span", "", button), ids = new Element("span", "radio-ids", row);
  const info = new Element("span", "radio-association-info", ids), icon = new Element("button", "", info);
  const popup = new Element("span", "radio-association-popup", info), link = new Element("a", "", popup);
  let selections = 0, opened = 0, followed = 0;
  context.RadioPlayer.bindRow(row, button, () => selections++);
  icon.addEventListener("click", () => opened++); link.addEventListener("click", () => followed++);
  for (const target of [row, ids, button, label]) {
    const previous = selections; target.click(); assert.equal(selections, previous + 1);
  }
  for (const target of [icon, popup, link]) target.click();
  assert.equal(selections, 4); assert.equal(opened, 1); assert.equal(followed, 1);
});

test("all player pages load the same core before their adapters and render one shared controls template", () => {
  const env = new nunjucks.Environment(new nunjucks.FileSystemLoader("src/_includes"));
  for (const [file, prefix] of [["police-radio", "radio"], ["law-2-radio", "law2-radio"], ["police-radio-excerpt", "excerpt"]]) {
    const source = readFileSync(`src/${file}.njk`, "utf8");
    assert.ok(source.indexOf('/js/radio-player-core.js') < source.indexOf(`/js/${file}.js`));
    assert.match(source, /from "radio-player.njk" import player/);
    const html = env.renderString(`{% from "radio-player.njk" import player %}{{ player("${prefix}") }}`);
    for (const suffix of ["play", "seek", "autoplay", "show-current", "controls-toggle", "transcript-text", "call-note"]) {
      assert.equal(html.split(`id="${prefix}-${suffix}"`).length - 1, 1);
    }
    assert.match(html, /class="radio-player"/);
    assert.match(html, /class="radio-seek"/);
    assert.match(html, /View Notes/);
  }
});

test("archive templates and excerpt rows share one escaped row macro", () => {
  const env = new nunjucks.Environment(new nunjucks.FileSystemLoader("src/_includes"));
  const render = call => env.renderString('{% from "radio-row.njk" import clipRow %}{{ clipRow(call, true) }}', { call });
  const call = { source: '/recording.m4a', seconds: 4, date: '2026-09-12', time: '1:23:45 PM', number: 275,
    iso: '2026-09-12T19:23:45Z', radioIds: '14590026', transcript: '<script>bad()</script>', note: 'A "quoted" note', validated: false };
  const populated = render(call), empty = render(false);
  for (const html of [populated, empty]) {
    for (const slot of ['data-radio-time', 'data-radio-number', 'data-radio-duration']) assert.match(html, new RegExp(slot));
    assert.equal((html.match(/class="radio-clip-row"/g) || []).length, 1);
    assert.equal((html.match(/class="radio-ids"/g) || []).length, 1);
    assert.ok(html.indexOf('</button>') < html.indexOf('class="radio-ids"'), 'association controls stay outside the playback button');
  }
  assert.match(populated, /data-excerpt-clip/);
  assert.match(populated, /· 275/);
  assert.match(populated, /&lt;script&gt;/);
  assert.doesNotMatch(populated, /<script>/);
  assert.match(populated, /&quot;quoted&quot;/);
  assert.doesNotMatch(empty, /data-excerpt-clip/);
  const player = env.renderString('{% from "radio-player.njk" import player %}{{ player("radio") }}');
  assert.equal((player.match(/id="radio-clip-row-template"/g) || []).length, 1);
  assert.match(readFileSync('src/police-radio-excerpt.njk', 'utf8'), /clipRow\(call, excerpt.enableTranscription\)/);
});
