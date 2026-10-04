const filters = document.querySelector(".city-official-filters");
const description = document.querySelector("#city-official-list-description");
const buttons = document.querySelectorAll("[data-city-official-filter]");
const cityOfficials = document.querySelectorAll(".officer-list > li");

const descriptions = {
  current: "Current American Fork city officials included in this directory. Select a name to explore the available records.",
  former: "Former American Fork city officials included in this directory. Select a name to explore the available records.",
  all: "Browse all current and former American Fork city officials included in this directory.",
};

if (filters && description && buttons.length) {
  function showFilter(filter) {
    if (!Object.hasOwn(descriptions, filter)) {
      return;
    }

    cityOfficials.forEach((cityOfficial) => {
      const matchesFilter =
        filter === "all" || cityOfficial.dataset.serviceStatus === filter;

      cityOfficial.hidden = !matchesFilter;
    });

    buttons.forEach((button) => {
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.cityOfficialFilter === filter)
      );
    });

    description.textContent = descriptions[filter];
  }

  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      showFilter(button.dataset.cityOfficialFilter);
    });
  });

  showFilter("current");
  filters.hidden = false;
}
