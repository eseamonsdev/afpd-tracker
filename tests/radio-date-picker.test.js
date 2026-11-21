import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync("public/js/radio-date-picker.js", "utf8");
class Element {
  constructor(tag) { Object.assign(this, { tag, children: [], dataset: {}, attrs: {}, events: {}, value: "", textContent: "" }); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; this.value = ""; }
  add(option) { this.children.push(option); if (this.children.length === 1) this.value = option.value; }
  setAttribute(key, value) { this.attrs[key] = value; }
  addEventListener(type, fn) { this.events[type] = fn; }
  contains(node) { return this === node || this.children.some(child => child.contains(node)); }
  focus() { this.focused = true; this.events.focus?.(); }
  click() { if (!this.disabled) this.events.click?.(); }
}
function fixture(days, value) {
  const window = {}, changes = [], container = new Element("section"), events = {};
  vm.runInNewContext(source, { window, Intl, Date, document: {
    createElement: tag => new Element(tag), createElementNS: (_, tag) => new Element(tag),
    addEventListener: (type, fn) => { events[type] = fn; }
  },
    Option: class extends Element { constructor(text, value) { super("option"); this.textContent = text; this.value = value; } } });
  const picker = window.RadioDatePicker.create(container, { days, value, onChange: date => changes.push(date) });
  const all = (node = container) => [node, ...node.children.flatMap(child => all(child))];
  return { container, picker, changes, all, events,
    trigger: () => all().find(node => node.className === "radio-calendar-trigger"),
    panel: () => all().find(node => node.className === "radio-calendar-panel"),
    selects: () => all().filter(node => node.tag === "select"),
    day: date => all().find(node => node.dataset.date === date),
    next: () => all().find(node => node.className === "radio-calendar-nav" && node.textContent === "›"),
    previous: () => all().find(node => node.className === "radio-calendar-nav" && node.textContent === "‹") };
}
const days = ["2025-12-31", "2026-02-02", "2026-02-04", "2026-11-19"].map(date => ({ date, count: 12 }));

test("date button starts collapsed, opens on the selected month, and selection closes with focus restored", () => {
  const f = fixture(days, "2026-02-02");
  assert.equal(f.panel().hidden, true);
  assert.equal(f.trigger().attrs["aria-expanded"], "false");
  assert.match(f.trigger().attrs["aria-label"], /February 2, 2026/);
  assert.equal(f.trigger().attrs["aria-controls"], f.panel().id);
  f.trigger().click();
  assert.equal(f.panel().hidden, false);
  assert.equal(f.day("2026-02-02").focused, true);
  f.day("2026-02-04").click();
  assert.equal(f.panel().hidden, true);
  assert.equal(f.trigger().attrs["aria-expanded"], "false");
  assert.equal(f.trigger().focused, true);
  assert.match(f.trigger().attrs["aria-label"], /February 4, 2026/);
  assert.deepEqual(f.changes, ["2026-02-04"]);
  f.trigger().click(); f.day("2026-02-04").click();
  assert.equal(f.panel().hidden, true);
  assert.equal(f.changes.length, 1, "selecting the same date closes without reloading");
});

test("Escape and outside pointer/focus close; internal interactions keep the calendar open", () => {
  const f = fixture(days, "2026-02-02");
  f.trigger().click();
  f.events.pointerdown({ target: f.selects()[1] });
  assert.equal(f.panel().hidden, false);
  let prevented = false, stopped = false;
  f.container.events.keydown({ key: "Escape", preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } });
  assert.equal(prevented && stopped, true);
  assert.equal(f.panel().hidden, true);
  assert.equal(f.trigger().focused, true);
  f.trigger().click(); f.trigger().focused = false;
  f.events.pointerdown({ target: new Element("button") });
  assert.equal(f.panel().hidden, true);
  assert.equal(f.trigger().focused, false, "outside interaction must not steal focus");
  f.trigger().click();
  f.events.focusin({ target: f.selects()[0] }); assert.equal(f.panel().hidden, false);
  f.events.focusin({ target: new Element("a") }); assert.equal(f.panel().hidden, true);
  f.trigger().click(); f.next().click();
  f.trigger().click(); f.trigger().click();
  assert.equal(f.selects()[1].value, "2026-02", "reopening starts on the selected date");
  assert.deepEqual(f.changes, []);
});

test("only available years/months are offered; missing days and month boundaries cannot be selected", () => {
  const f = fixture(days, "2026-02-02");
  const [year, month] = f.selects();
  assert.deepEqual(year.children.map(node => node.value), ["2025", "2026"]);
  assert.deepEqual(month.children.map(node => node.value), ["2026-02", "2026-11"]);
  assert.equal(f.day("2026-02-03").disabled, true);
  f.day("2026-02-03").click(); assert.deepEqual(f.changes, []);
  f.day("2026-02-04").click();
  assert.deepEqual(f.changes, ["2026-02-04"]);
  assert.equal(f.picker.value, "2026-02-04");
  assert.equal(f.day("2026-02-04").attrs["aria-pressed"], "true");
  assert.match(f.day("2026-02-04").attrs["aria-label"], /12 clips/);
  f.day("2026-02-04").click(); assert.equal(f.changes.length, 1);
  f.previous().click(); assert.equal(f.previous().disabled, true);
  assert.equal(month.value, "2025-12");
  f.next().click(); assert.equal(month.value, "2026-02");
  f.next().click(); assert.equal(month.value, "2026-11");
  assert.equal(f.next().disabled, true);
  assert.equal(f.changes.length, 1, "browsing months never selects or loads a day");
});

test("year changes restrict months; invalid initial dates fall back to the latest available day", () => {
  const f = fixture([...days, { date: "2026-02-30" }, { date: "invalid" }], "2026-02-03");
  assert.equal(f.picker.value, "2026-11-19");
  const [year, month] = f.selects();
  year.value = "2025"; year.events.change();
  assert.deepEqual(month.children.map(node => node.value), ["2025-12"]);
  assert.equal(f.picker.value, "2026-11-19");
  assert.match(f.all().find(node => node.className === "radio-calendar-selected").textContent, /November 19, 2026/);
  assert.deepEqual(f.changes, []);
});

test("keyboard navigation skips unavailable dates without changing selection", () => {
  const f = fixture(days, "2026-02-02");
  let prevented = false;
  f.day("2026-02-02").events.keydown({ key: "ArrowRight", preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(f.day("2026-02-04").focused, true);
  assert.equal(f.picker.value, "2026-02-02");
  assert.deepEqual(f.changes, []);
  f.day("2026-02-04").events.keydown({ key: "PageDown", preventDefault() {} });
  assert.equal(f.day("2026-11-19").focused, true);
  f.day("2026-11-19").click();
  assert.deepEqual(f.changes, ["2026-11-19"]);
});

test("leap days are available only when supplied; empty indexes render a clear empty state", () => {
  const leap = fixture([{ date: "2024-02-29", count: 1 }], "2024-02-29");
  assert.equal(leap.day("2024-02-29").disabled, false);
  assert.equal(leap.day("2024-02-28").disabled, true);
  const empty = fixture([], "");
  assert.equal(empty.picker, null);
  assert.equal(empty.container.textContent, "No recordings are available yet.");
});

test("both archives use the shared calendar; excerpts retain their fixed dates", () => {
  for (const [file, prefix] of [["police-radio", "radio"], ["law-2-radio", "law2-radio"]]) {
    const source = readFileSync(`src/${file}.njk`, "utf8");
    assert.ok(source.includes(`datePicker("${prefix}")`));
    assert.ok(source.indexOf("/js/radio-date-picker.js") < source.indexOf(`/js/${file}.js`));
    assert.match(source, /\/css\/radio-date-picker.css/);
    assert.doesNotMatch(source, /radio-date-selectors/);
  }
  assert.doesNotMatch(readFileSync("src/police-radio-excerpt.njk", "utf8"), /radio-date-picker/);
});
