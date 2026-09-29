const filters = document.querySelector(".officer-filters");
const description = document.querySelector("#officer-list-description");
const buttons = document.querySelectorAll("[data-officer-filter]");
const officers = document.querySelectorAll(".officer-list > li");

const descriptions = {
  key: "Officers with records relating to specific incidents or concerns involving the American Fork Police Department. These records are the primary focus of this site.",
  all: "Browse all officers alphabetically by name. Select a name to explore the available records.",
  current: "Officers whose available employment records do not list an end date with the American Fork Police Department. Employment status reflects the most recent records available to this site.",
  former: "Officers whose available employment records list an end date with the American Fork Police Department.",
};

if (filters && description && buttons.length) {
  function showFilter(filter) {
    if (!Object.hasOwn(descriptions, filter)) {
      return;
    }

    officers.forEach((officer) => {
      let matchesFilter = false;

      if (filter === "all") {
        matchesFilter = true;
      } else if (filter === "key") {
        matchesFilter = officer.dataset.keyRecords === "true";
      } else {
        matchesFilter = officer.dataset.employmentStatus === filter;
      }

      officer.hidden = !matchesFilter;
    });

    buttons.forEach((button) => {
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.officerFilter === filter)
      );
    });

    description.textContent = descriptions[filter];
  }

  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      showFilter(button.dataset.officerFilter);
    });
  });

  showFilter("key");
  filters.hidden = false;
}
