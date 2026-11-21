(() => {
  "use strict";
  const dateObject = value => new Date(`${value}T12:00:00Z`);
  const monthFormat = new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" });
  const dateFormat = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
  const buttonFormat = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
  let pickerNumber = 0;
  const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(dateObject(value).getTime()) && dateObject(value).toISOString().slice(0, 10) === value;

  // The caller supplies its talkgroup's available days. Browsing never selects
  // a date or loads recordings; only activating an available day calls onChange.
  function create(container, { days, value, onChange, allowUnavailable = false }) {
    const entries = new Map(days.filter(entry => validDate(entry.date)).map(entry => [entry.date, entry]));
    const dates = [...entries.keys()].sort();
    container.replaceChildren();
    if (!dates.length) {
      container.textContent = "No recordings are available yet.";
      return null;
    }
    const months = [...new Set(dates.map(date => date.slice(0, 7)))];
    const years = [...new Set(dates.map(date => date.slice(0, 4)))];
    let selected = entries.has(value) || (allowUnavailable && validDate(value)) ? value : dates.at(-1);
    const selectedMonth = () => months.includes(selected.slice(0, 7)) ? selected.slice(0, 7) : months.at(-1);
    let viewed = selectedMonth();
    let focusDate = selected;
    const make = (tag, className, text) => {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    };
    const trigger = make("button", "radio-calendar-trigger");
    trigger.type = "button";
    trigger.setAttribute("aria-expanded", "false");
    const panel = make("div", "radio-calendar-panel");
    panel.id = `${container.id || `radio-date-picker-${++pickerNumber}`}-panel`;
    panel.hidden = true;
    trigger.setAttribute("aria-controls", panel.id);
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.setAttribute("viewBox", "0 0 24 24");
    icon.setAttribute("aria-hidden", "true");
    icon.setAttribute("focusable", "false");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M5 4h14a1 1 0 0 1 1 1v15H4V5a1 1 0 0 1 1-1Zm3-2v5m8-5v5M4 10h16");
    icon.append(path);
    const triggerText = make("span");
    const chevron = make("span", "radio-calendar-chevron");
    chevron.setAttribute("aria-hidden", "true");
    trigger.append(icon, triggerText, chevron);
    const intro = make("p", "radio-calendar-help", "Choose a recording date. Only months with recordings are listed; unavailable days are disabled.");
    const availability = make("p", "radio-calendar-availability", `Available years: ${years.join(", ")}`);
    const controls = make("div", "radio-calendar-controls");
    const year = make("select"), month = make("select");
    year.setAttribute("aria-label", "Year");
    month.setAttribute("aria-label", "Month");
    const label = (text, input) => {
      const node = make("label", "", text);
      node.append(input);
      return node;
    };
    for (const value of years) year.add(new Option(value, value));
    const previous = make("button", "radio-calendar-nav", "‹");
    const next = make("button", "radio-calendar-nav", "›");
    for (const button of [previous, next]) button.type = "button";
    const title = make("p", "radio-calendar-title");
    title.setAttribute("aria-live", "polite");
    title.setAttribute("aria-atomic", "true");
    const heading = make("div", "radio-calendar-heading");
    heading.append(previous, title, next);
    controls.append(label("Year", year), label("Month", month));
    const table = make("table", "radio-calendar-grid");
    const caption = make("caption", "radio-sr-only");
    const head = make("thead"), weekdays = make("tr");
    ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].forEach(name => {
      const th = make("th"); th.scope = "col";
      const abbr = make("abbr", "", name.slice(0, 2)); abbr.title = name;
      th.append(abbr); weekdays.append(th);
    });
    head.append(weekdays);
    const body = make("tbody");
    table.append(caption, head, body);
    const summary = make("p", "radio-calendar-selected");
    summary.setAttribute("role", "status");
    panel.append(intro, availability, controls, heading, table, summary);
    container.append(trigger, panel);
    const buttons = new Map();

    function setOpen(open, restoreFocus = false) {
      panel.hidden = !open;
      trigger.setAttribute("aria-expanded", String(open));
      if (open) {
        viewed = selectedMonth(); focusDate = selected;
        render(); buttons.get(focusDate)?.focus();
      } else if (restoreFocus) trigger.focus();
    }
    trigger.addEventListener("click", () => setOpen(panel.hidden));
    container.addEventListener("keydown", event => {
      if (event.key === "Escape" && !panel.hidden) {
        event.preventDefault(); event.stopPropagation(); setOpen(false, true);
      }
    });
    document.addEventListener("pointerdown", event => {
      if (!panel.hidden && !container.contains(event.target)) setOpen(false);
    });
    document.addEventListener("focusin", event => {
      if (!panel.hidden && !container.contains(event.target)) setOpen(false);
    });

    function render() {
      triggerText.textContent = buttonFormat.format(dateObject(selected));
      trigger.setAttribute("aria-label", `Choose recording date: ${triggerText.textContent}`);
      year.value = viewed.slice(0, 4);
      month.replaceChildren();
      for (const value of months.filter(value => value.startsWith(`${year.value}-`))) {
        month.add(new Option(monthFormat.format(dateObject(`${value}-01`)), value));
      }
      month.value = viewed;
      const monthTitle = `${monthFormat.format(dateObject(`${viewed}-01`))} ${year.value}`;
      title.textContent = monthTitle; caption.textContent = monthTitle;
      const index = months.indexOf(viewed);
      previous.disabled = index === 0; next.disabled = index === months.length - 1;
      previous.setAttribute("aria-label", index > 0 ? `Previous available month: ${monthFormat.format(dateObject(`${months[index - 1]}-01`))} ${months[index - 1].slice(0, 4)}` : "No earlier recordings");
      next.setAttribute("aria-label", index < months.length - 1 ? `Next available month: ${monthFormat.format(dateObject(`${months[index + 1]}-01`))} ${months[index + 1].slice(0, 4)}` : "No later recordings");
      const available = dates.filter(date => date.startsWith(`${viewed}-`));
      if (!available.includes(focusDate)) focusDate = available.includes(selected) ? selected : available[0];
      body.replaceChildren(); buttons.clear();
      const first = dateObject(`${viewed}-01`);
      const length = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
      const slots = Math.ceil((first.getUTCDay() + length) / 7) * 7;
      let row;
      for (let slot = 0; slot < slots; slot++) {
        if (slot % 7 === 0) { row = make("tr"); body.append(row); }
        const cell = make("td"); row.append(cell);
        const number = slot - first.getUTCDay() + 1;
        if (number < 1 || number > length) continue;
        const date = `${viewed}-${String(number).padStart(2, "0")}`;
        const entry = entries.get(date);
        const button = make("button", "radio-calendar-day", String(number));
        button.type = "button"; button.disabled = !entry;
        button.dataset.date = date;
        button.tabIndex = date === focusDate ? 0 : -1;
        button.setAttribute("aria-pressed", String(!!entry && date === selected));
        const count = Number.isInteger(entry?.count) ? `, ${entry.count} clips` : "";
        button.setAttribute("aria-label", `${dateFormat.format(dateObject(date))}${entry ? count : ", no recordings"}`);
        button.addEventListener("focus", () => {
          focusDate = date;
          for (const [key, node] of buttons) node.tabIndex = key === date ? 0 : -1;
        });
        button.addEventListener("click", () => {
          if (!entry) return;
          const changed = date !== selected;
          selected = date; focusDate = date;
          render(); setOpen(false, true);
          if (changed) onChange?.(date);
        });
        button.addEventListener("keydown", event => moveFocus(event, date));
        buttons.set(date, button); cell.append(button);
      }
      summary.textContent = `Selected: ${dateFormat.format(dateObject(selected))}${entries.has(selected) ? "" : " — no recordings for this talkgroup"}`;
    }
    function browse(value, focus = false) {
      if (!months.includes(value)) return;
      viewed = value; render();
      if (focus) buttons.get(focusDate)?.focus();
    }
    function moveFocus(event, date) {
      const steps = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
      let target;
      if (Object.hasOwn(steps, event.key)) {
        const stamp = dateObject(date); stamp.setUTCDate(stamp.getUTCDate() + steps[event.key]);
        const boundary = stamp.toISOString().slice(0, 10);
        target = steps[event.key] < 0 ? dates.findLast(value => value <= boundary) : dates.find(value => value >= boundary);
      } else if (event.key === "Home" || event.key === "End") {
        const stamp = dateObject(date), start = new Date(stamp);
        start.setUTCDate(start.getUTCDate() - start.getUTCDay());
        const end = new Date(start); end.setUTCDate(end.getUTCDate() + 6);
        const week = dates.filter(value => value >= start.toISOString().slice(0, 10) && value <= end.toISOString().slice(0, 10));
        target = event.key === "Home" ? week[0] : week.at(-1);
      } else if (event.key === "PageUp" || event.key === "PageDown") {
        const value = months[months.indexOf(viewed) + (event.key === "PageUp" ? -1 : 1)];
        if (value) target = dates.find(date => date.startsWith(`${value}-`));
      } else return;
      event.preventDefault();
      if (target) { focusDate = target; browse(target.slice(0, 7), true); }
    }
    year.addEventListener("change", () => {
      const sameMonth = `${year.value}-${viewed.slice(5)}`;
      browse(months.includes(sameMonth) ? sameMonth : months.find(value => value.startsWith(`${year.value}-`)));
    });
    month.addEventListener("change", () => browse(month.value));
    previous.addEventListener("click", () => browse(months[months.indexOf(viewed) - 1]));
    next.addEventListener("click", () => browse(months[months.indexOf(viewed) + 1]));
    render();
    return { get value() { return selected; } };
  }
  window.RadioDatePicker = { create };
})();
