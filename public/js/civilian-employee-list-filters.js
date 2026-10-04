const filters = document.querySelector(".civilian-employee-filters");
const description = document.querySelector(
  "#civilian-employee-list-description"
);
const buttons = document.querySelectorAll("[data-civilian-employee-filter]");
const civilianEmployees = document.querySelectorAll(".officer-list > li");

const descriptions = {
  current:
    "Current American Fork Police Department civilian employees included in this directory. Select a name to explore the available records.",
  former:
    "Former American Fork Police Department civilian employees included in this directory. Select a name to explore the available records.",
  all: "Browse all current and former American Fork Police Department civilian employees included in this directory.",
};

if (filters && description && buttons.length) {
  function showFilter(filter) {
    if (!Object.hasOwn(descriptions, filter)) {
      return;
    }

    civilianEmployees.forEach((civilianEmployee) => {
      const matchesFilter =
        filter === "all" ||
        civilianEmployee.dataset.serviceStatus === filter;

      civilianEmployee.hidden = !matchesFilter;
    });

    buttons.forEach((button) => {
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.civilianEmployeeFilter === filter)
      );
    });

    description.textContent = descriptions[filter];
  }

  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      showFilter(button.dataset.civilianEmployeeFilter);
    });
  });

  showFilter("current");
  filters.hidden = false;
}
