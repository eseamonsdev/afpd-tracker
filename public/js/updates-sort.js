(() => {
  const list = document.querySelector("[data-updates-list]");
  const controls = document.querySelector("[data-updates-sort]");
  if (!list || !controls) return;

  const entries = Array.from(list.children).map((element, index) => ({
    element,
    index,
    date: element.getAttribute("data-update-date") || ""
  }));
  const buttons = Array.from(controls.querySelectorAll("[data-sort-order]"));

  function setOrder(order, updateUrl) {
    if (order !== "earliest" && order !== "latest") order = "latest";
    const ordered = [...entries].sort((a, b) => {
      const byDate = a.date.localeCompare(b.date);
      return (order === "earliest" ? byDate : -byDate) || a.index - b.index;
    });
    for (const entry of ordered) list.appendChild(entry.element);
    for (const button of buttons) {
      button.setAttribute("aria-pressed", String(button.dataset.sortOrder === order));
    }
    if (updateUrl) {
      const url = new URL(window.location.href);
      if (order === "latest") url.searchParams.delete("sort");
      else url.searchParams.set("sort", "earliest");
      window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    }
  }

  const requested = new URL(window.location.href).searchParams.get("sort");
  setOrder(requested === "earliest" ? "earliest" : "latest", false);
  for (const button of buttons) {
    button.addEventListener("click", () => setOrder(button.dataset.sortOrder, true));
  }
  window.addEventListener("popstate", () => {
    const order = new URL(window.location.href).searchParams.get("sort");
    setOrder(order === "earliest" ? "earliest" : "latest", false);
  });
})();
