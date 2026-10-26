import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { loadJsonFiles } from "../lib/data/load-json-files.js";
import { profilePageTypes, validateProfileTabs } from "../lib/profile-tabs.js";

function tabsAt(address) {
  const element = (id) => ({
    id, attrs: {}, listeners: {}, dataset: { sectionTab: id },
    setAttribute(key, value) { this.attrs[key] = value; },
    addEventListener(name, fn) { this.listeners[name] = fn; },
    focus() { this.focused = true; }
  });
  const tabs = [element("overview"), element("criminal-cases"), element("employment")];
  const panels = tabs.map(tab => element(`panel-${tab.id}`));
  const list = element("list");
  const container = {
    querySelector: () => list,
    querySelectorAll: selector => selector === "[data-section-tab]" ? tabs : panels
  };
  const window = {
    location: { href: address }, listeners: {}, entries: [address], position: 0,
    addEventListener(name, fn) { this.listeners[name] = fn; }
  };
  window.history = { pushState(_state, _unused, url) {
    window.entries.splice(++window.position);
    window.entries.push(String(url));
    window.location.href = String(url);
  } };
  vm.runInNewContext(fs.readFileSync("public/js/officer-tabs.js", "utf8"), {
    URL, window, document: { querySelectorAll: () => [container] }
  });
  return {
    tabs, panels, window, list,
    selected: () => tabs.find(tab => tab.attrs["aria-selected"] === "true")?.id,
    travel(delta) {
      window.position += delta;
      window.location.href = window.entries[window.position];
      window.listeners.popstate();
    }
  };
}

test("direct tab links, fallback, clicks, URL preservation and history navigation", () => {
  for (const query of ["", "?tab=missing", "?tab=Criminal-Cases"]) {
    assert.equal(tabsAt(`https://example.com/profile/${query}`).selected(), "overview");
  }
  const ui = tabsAt("https://example.com/profile/?source=lawsuit&tab=criminal-cases#documents");
  assert.equal(ui.selected(), "criminal-cases");
  assert.equal(ui.panels.filter(panel => !panel.hidden).length, 1);
  assert.equal(ui.list.hidden, false);
  ui.tabs[1].listeners.click();
  assert.equal(ui.window.entries.length, 1, "clicking the selected tab does not duplicate history");
  ui.tabs[2].listeners.click();
  assert.equal(ui.selected(), "employment");
  const url = new URL(ui.window.location.href);
  assert.equal(url.searchParams.get("tab"), "employment");
  assert.equal(url.searchParams.get("source"), "lawsuit");
  assert.equal(url.hash, "#documents");
  ui.travel(-1); assert.equal(ui.selected(), "criminal-cases");
  ui.travel(1); assert.equal(ui.selected(), "employment");
});

test("keyboard selection updates the shareable URL and keeps focus on the active tab", () => {
  const ui = tabsAt("https://example.com/profile/");
  for (const [index, key, expected] of [[0, "End", 2], [2, "ArrowRight", 0], [0, "ArrowLeft", 2], [2, "Home", 0]]) {
    let prevented = false;
    ui.tabs[index].listeners.keydown({ key, preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
    assert.equal(ui.selected(), ui.tabs[expected].id);
    assert.equal(new URL(ui.window.location.href).searchParams.get("tab"), ui.tabs[expected].id);
    assert.equal(ui.tabs[expected].focused, true);
  }
});

test("all four profile types enforce stable, unique section IDs, including hidden tabs", () => {
  for (const type of profilePageTypes) {
    const page = { id: "example", type, sections: [{ id: "criminal-cases", title: "Criminal Cases" }] };
    validateProfileTabs(page);
    page.sections[0].title = "Renamed";
    validateProfileTabs(page);
    for (const id of [undefined, "", "Criminal Cases", "criminal_cases", "-criminal", "criminal--cases"]) {
      assert.throws(() => validateProfileTabs({ ...page, sections: [{ id, title: "Example" }] }), /kebab-case/);
    }
    assert.throws(() => validateProfileTabs({ ...page, sections: [...page.sections, { ...page.sections[0], published: false }] }), /duplicate/);
  }
});

test("existing profile data and all four templates use explicit section IDs", () => {
  const counts = new Map();
  for (const { data } of loadJsonFiles("./data/entities/pages")) {
    for (const entity of data.entities || []) {
      if (!profilePageTypes.has(entity.type)) continue;
      validateProfileTabs(entity);
      counts.set(entity.type, (counts.get(entity.type) || 0) + 1);
    }
  }
  for (const type of profilePageTypes) {
    assert.ok(counts.get(type) > 0, type);
    const template = fs.readFileSync(`src/${type}.njk`, "utf8");
    assert.ok(template.includes('data-section-tab="{{ section.id | escape }}"'), type);
    assert.ok(template.includes('aria-controls="officer-section-{{ section.id | escape }}"'), type);
    assert.ok(!template.includes("loop.index"), type);
  }
});
