"use strict";

document.querySelectorAll("[data-identifier-sections]").forEach((container) => {
  const list = container.querySelector("[data-identifier-tabs]");
  const tabs = Array.from(container.querySelectorAll("[data-identifier-tab]"));
  const panels = Array.from(container.querySelectorAll("[data-identifier-panel]"));
  if (!list || !tabs.length || tabs.length !== panels.length) return;

  list.setAttribute("role", "tablist");
  list.setAttribute("aria-label", "Observed officer identifier types");
  tabs.forEach((tab, index) => {
    tab.setAttribute("role", "tab");
    panels[index].setAttribute("role", "tabpanel");
    panels[index].setAttribute("aria-labelledby", tab.id);
    panels[index].setAttribute("tabindex", "0");
  });

  function activate(index, moveFocus = false) {
    tabs.forEach((tab, position) => {
      const selected = position === index;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
      panels[position].hidden = !selected;
    });
    if (moveFocus) tabs[index].focus();
  }

  function fromUrl() {
    const id = new URL(window.location.href).searchParams.get("identifier");
    const index = tabs.findIndex(tab => tab.dataset.identifierTab === id);
    activate(index < 0 ? 0 : index);
  }

  function select(index, moveFocus = false) {
    const url = new URL(window.location.href);
    const id = tabs[index].dataset.identifierTab;
    if (url.searchParams.get("identifier") !== id) {
      url.searchParams.set("identifier", id);
      window.history.pushState(null, "", url);
    }
    activate(index, moveFocus);
  }

  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => select(index));
    tab.addEventListener("keydown", (event) => {
      let next;
      switch (event.key) {
        case "ArrowRight": next = (index + 1) % tabs.length; break;
        case "ArrowLeft": next = (index - 1 + tabs.length) % tabs.length; break;
        case "Home": next = 0; break;
        case "End": next = tabs.length - 1; break;
        default: return;
      }
      event.preventDefault();
      select(next, true);
    });
  });

  window.addEventListener("popstate", fromUrl);
  fromUrl();
  list.hidden = false;
});
