"use strict";

document.querySelectorAll("[data-officer-sections]").forEach((container) => {
  const tabList = container.querySelector("[data-section-tabs]");
  const tabs = Array.from(
    container.querySelectorAll("[data-section-tab]")
  );
  const panels = Array.from(
    container.querySelectorAll("[data-section-panel]")
  );

  if (!tabList || tabs.length === 0 || tabs.length !== panels.length) {
    return;
  }

  tabList.setAttribute("role", "tablist");
  tabList.setAttribute("aria-label", "Profile record sections");

  tabs.forEach((tab, index) => {
    tab.setAttribute("role", "tab");

    panels[index].setAttribute("role", "tabpanel");
    panels[index].setAttribute("aria-labelledby", tab.id);
    panels[index].setAttribute("tabindex", "0");
  });

  function activateTab(selectedIndex, moveFocus = false) {
    tabs.forEach((tab, index) => {
      const isSelected = index === selectedIndex;

      tab.setAttribute("aria-selected", String(isSelected));
      tab.tabIndex = isSelected ? 0 : -1;
      panels[index].hidden = !isSelected;
    });

    if (moveFocus) {
      tabs[selectedIndex].focus();
    }
  }

  function activateTabFromUrl() {
    const requestedId = new URL(window.location.href).searchParams.get("tab");
    const selectedIndex = tabs.findIndex((tab) => tab.dataset.sectionTab === requestedId);
    activateTab(selectedIndex < 0 ? 0 : selectedIndex);
  }

  function selectTab(index, moveFocus = false) {
    const url = new URL(window.location.href);
    const id = tabs[index].dataset.sectionTab;
    if (url.searchParams.get("tab") !== id) {
      url.searchParams.set("tab", id);
      window.history.pushState(null, "", url);
    }
    activateTab(index, moveFocus);
  }

  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => {
      selectTab(index);
    });

    tab.addEventListener("keydown", (event) => {
      let nextIndex;

      switch (event.key) {
        case "ArrowRight":
          nextIndex = (index + 1) % tabs.length;
          break;

        case "ArrowLeft":
          nextIndex = (index - 1 + tabs.length) % tabs.length;
          break;

        case "Home":
          nextIndex = 0;
          break;

        case "End":
          nextIndex = tabs.length - 1;
          break;

        default:
          return;
      }

      event.preventDefault();
      selectTab(nextIndex, true);
    });
  });

  window.addEventListener("popstate", activateTabFromUrl);
  activateTabFromUrl();
  tabList.hidden = false;
});
