const filters = document.querySelector(".officer-filters");
const description = document.querySelector("#officer-list-description");
const buttons = document.querySelectorAll("[data-officer-filter]");
const officers = document.querySelectorAll(".officer-list > li");

if (filters && description && buttons.length === 2) {
  function showFilter(filter) {
    officers.forEach((officer) => {
      officer.hidden =
        filter === "key" && officer.dataset.keyRecords !== "true";
    });

    buttons.forEach((button) => {
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.officerFilter === filter)
      );
    });

    description.textContent =
      filter === "key"
        ? "Officers with records relating to specific incidents or concerns involving the American Fork Police Department. These records are the primary focus of this site."
        : "Browse all officers alphabetically by name. Select a name to explore the available records.";
  }

  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      showFilter(button.dataset.officerFilter);
    });
  });

  showFilter("key");
  filters.hidden = false;
}
