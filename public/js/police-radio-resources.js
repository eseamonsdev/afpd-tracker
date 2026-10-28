(() => {
  const list = document.querySelector('.radio-id-tabs');
  if (!list) return;
  const tabs = [...list.querySelectorAll('[role="tab"]')];
  function select(tab) {
    tabs.forEach(item => {
      const active = item === tab;
      item.setAttribute('aria-selected', String(active));
      item.tabIndex = active ? 0 : -1;
      const panel = document.getElementById(item.getAttribute('aria-controls'));
      panel.setAttribute('role', 'tabpanel');
      panel.hidden = !active;
    });
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => select(tab));
    tab.addEventListener('keydown', event => {
      let next;
      if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
      if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = tabs.length - 1;
      if (next === undefined) return;
      event.preventDefault();
      select(tabs[next]);
      tabs[next].focus();
    });
  });
  // Refresh the IDs-only tables from the same dedicated source used at build time.
  async function refreshIds() {
    try {
      const response = await fetch('/records/openmhz/radio-agency-identifiers.json');
      if (!response.ok) return;
      const data = await response.json();
      if (!Array.isArray(data.entries) || !Array.isArray(data.evidence)) return;
      const validId = entry => /^[1-9]\d*$/.test(entry.radioId) && /^\d+J\d+$/.test(entry.agencyId);
      const validDate = date => /^\d{4}-\d{2}-\d{2}$/.test(date);
      if (!data.entries.every(entry => validId(entry) && Array.isArray(entry.dates) && entry.dates.every(validDate)) ||
          !data.evidence.every(entry => validId(entry) && validDate(entry.date))) return;
      const makeRow = values => {
        const row = document.createElement('tr');
        values.forEach((value, index) => {
          const cell = document.createElement(index === 0 ? 'th' : 'td');
          if (index === 0) cell.scope = 'row';
          cell.textContent = value;
          row.append(cell);
        });
        return row;
      };
      const mapping = document.querySelector('#radio-mappings-panel tbody');
      const evidence = document.querySelector('#radio-evidence-panel tbody');
      if (!mapping || !evidence) return;
      mapping.replaceChildren(...data.entries.map(entry => makeRow([entry.radioId, entry.agencyId, entry.dates.join(', ')])));
      evidence.replaceChildren(...data.evidence.map(entry => {
        const row = makeRow([entry.radioId, entry.agencyId, entry.date, entry.talkgroup, entry.basis]);
        const link = document.createElement('a');
        link.href = '/law-2-radio/?date=' + entry.date;
        link.textContent = entry.date;
        row.children[2].replaceChildren(link);
        return row;
      }));
    } catch { /* Keep the built tables if the refresh is unavailable. */ }
  }
  refreshIds();
  list.hidden = false;
  select(tabs[0]);
})();
