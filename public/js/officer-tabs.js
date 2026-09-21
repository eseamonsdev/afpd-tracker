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
  tabList.setAttribute("aria-label", "Officer record sections");

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

  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => {
      activateTab(index);
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
      activateTab(nextIndex, true);
    });
  });

  activateTab(0);
  tabList.hidden = false;
});
