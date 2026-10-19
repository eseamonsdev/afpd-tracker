const filters = document.querySelector(".officer-filters");
const description = document.querySelector("#officer-list-description");
const buttons = document.querySelectorAll("[data-officer-filter]");
const officers = document.querySelectorAll(".officer-list > li");
const searchContainer = document.querySelector(".officer-search");
const searchInput = document.querySelector("#officer-name-search");
const searchStatus = document.querySelector("#officer-search-status");

function normalizeName(value) {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

const descriptions = {
  key: "Officers with records relating to specific incidents or concerns involving the American Fork Police Department. These records are the primary focus of this site.",
  forced: "Officers documented as having resigned in lieu of termination, or confirmed by department leadership or POST proceedings to have been required to resign.",
  all: "Browse all officers alphabetically by name. Select a name to explore the available records.",
  current: "Officers whose available employment records do not list an end date with the American Fork Police Department. Employment status reflects the most recent records available to this site.",
  former: "Officers whose available employment records list an end date with the American Fork Police Department.",
};

if (filters && description && buttons.length) {
  let activeFilter = "key";

  function showFilter(filter) {
    if (!Object.hasOwn(descriptions, filter)) {
      return;
    }

    activeFilter = filter;
    const queryWords = normalizeName(searchInput?.value || "").split(" ").filter(Boolean);
    let visibleCount = 0;

    officers.forEach((officer) => {
      let matchesFilter = false;

      if (filter === "all") {
        matchesFilter = true;
      } else if (filter === "key") {
        matchesFilter = officer.dataset.keyRecords === "true";
      } else if (filter === "forced") {
        matchesFilter = officer.dataset.forcedResignation === "true";
      } else {
        matchesFilter = officer.dataset.employmentStatus === filter;
      }

      const names = normalizeName(officer.dataset.searchNames || officer.textContent);
      officer.hidden = !(matchesFilter && queryWords.every((word) => names.includes(word)));
      if (!officer.hidden) visibleCount += 1;
    });

    buttons.forEach((button) => {
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.officerFilter === filter)
      );
    });

    description.textContent = descriptions[filter];
    if (searchStatus) {
      searchStatus.hidden = queryWords.length === 0;
      searchStatus.textContent = visibleCount === 0
        ? "No officers match this name in the selected category. Try All to search every officer."
        : `${visibleCount} ${visibleCount === 1 ? "officer matches" : "officers match"} this name.`;
    }
  }

  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      showFilter(button.dataset.officerFilter);
    });
  });

  showFilter("key");
  filters.hidden = false;
  if (searchInput && searchContainer) {
    searchInput.addEventListener("input", () => showFilter(activeFilter));
    searchContainer.hidden = false;
  }
}
