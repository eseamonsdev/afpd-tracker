import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

function identifierTabs(query = "?tab=observed-agency-ids", ids = ["call-sign", "radio-id"]) {
  const element = id => ({
    id, dataset: { identifierTab: id }, attrs: {}, listeners: {},
    setAttribute(key, value) { this.attrs[key] = value; },
    addEventListener(key, value) { this.listeners[key] = value; },
    focus() { this.focused = true; }
  });
  const tabs = ids.map(element);
  const panels = ids.map(id => element(`identifier-panel-${id}`));
  const list = element("list");
  const container = {
    querySelector: () => list,
    querySelectorAll: selector => selector === "[data-identifier-tab]" ? tabs : panels
  };
  const window = {
    location: { href: `https://example.com/officers/example/${query}` },
    listeners: {},
    addEventListener(key, value) { this.listeners[key] = value; }
  };
  const entries = [window.location.href];
  window.history = { pushState(_state, _unused, url) {
    window.location.href = String(url);
    entries.push(String(url));
  } };
  vm.runInNewContext(fs.readFileSync("public/js/officer-identifier-tabs.js", "utf8"), {
    URL, window, document: { querySelectorAll: () => [container] }
  });
  return { tabs, panels, list, window, entries,
    selected: () => tabs.find(tab => tab.attrs["aria-selected"] === "true")?.id
  };
}

test("identifier tabs default to the first available type and preserve the parent tab", () => {
  const ui = identifierTabs("?tab=observed-agency-ids&source=records#evidence");
  assert.equal(ui.selected(), "call-sign");
  assert.equal(ui.list.hidden, false);
  assert.equal(ui.panels.filter(panel => !panel.hidden).length, 1);
  ui.tabs[1].listeners.click();
  assert.equal(ui.selected(), "radio-id");
  const url = new URL(ui.window.location.href);
  assert.equal(url.searchParams.get("tab"), "observed-agency-ids");
  assert.equal(url.searchParams.get("identifier"), "radio-id");
  assert.equal(url.searchParams.get("source"), "records");
  assert.equal(url.hash, "#evidence");
  ui.tabs[1].listeners.click();
  assert.equal(ui.entries.length, 2);
  ui.window.location.href = ui.entries[0];
  ui.window.listeners.popstate();
  assert.equal(ui.selected(), "call-sign");
  assert.equal(identifierTabs("?identifier=unknown").selected(), "call-sign");
  assert.equal(identifierTabs("?identifier=radio-id").selected(), "radio-id");
  assert.equal(identifierTabs("", ["radio-id"]).selected(), "radio-id");
});

test("identifier keyboard navigation wraps, moves focus, and exposes accessible panels", () => {
  const ui = identifierTabs();
  assert.equal(ui.list.attrs.role, "tablist");
  for (const [index, key, expected] of [[0, "End", 1], [1, "ArrowRight", 0], [0, "ArrowLeft", 1], [1, "Home", 0]]) {
    let prevented = false;
    ui.tabs[index].listeners.keydown({ key, preventDefault() { prevented = true; } });
    assert.ok(prevented);
    assert.equal(ui.selected(), ui.tabs[expected].id);
    assert.ok(ui.tabs[expected].focused);
    assert.equal(ui.panels[expected].attrs["aria-labelledby"], ui.tabs[expected].id);
    assert.equal(ui.panels.filter(panel => !panel.hidden).length, 1);
  }
});

test("every existing observed IDs panel renders only its existing identifier sections in order", () => {
  let count = 0;
  for (const slug of fs.readdirSync("public/officers")) {
    const file = `public/officers/${slug}/index.html`;
    if (!fs.existsSync(file)) continue;
    const html = fs.readFileSync(file, "utf8");
    if (!html.includes('data-section-tab="observed-agency-ids"')) {
      assert.ok(!html.includes("data-identifier-sections"));
      continue;
    }
    count++;
    const expected = [];
    if (html.includes('aria-label="Call sign assignments')) expected.push("call-sign");
    if (html.includes('aria-label="Radio ID observations')) expected.push("radio-id");
    assert.doesNotMatch(html, /UCJIS User ID|identifier-(?:tab|panel)-ucjis-user-id/);
    const tabs = [...html.matchAll(/data-identifier-tab="([^"]+)"/g)].map(match => match[1]);
    const panels = [...html.matchAll(/id="identifier-panel-([^"]+)"/g)].map(match => match[1]);
    assert.deepEqual(tabs, expected, slug);
    assert.deepEqual(panels, expected, slug);
    assert.match(html, /data-identifier-tabs hidden/);
    assert.doesNotMatch(html, /data-identifier-panel[^>]*\bhidden/);
  }
  assert.ok(count > 0);
});
