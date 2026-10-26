export const profilePageTypes = new Set([
  "officer-page",
  "civilian-employee-page",
  "city-official-page",
  "police-encounter-page"
]);

/** IDs are explicit so renaming or reordering a section preserves shared URLs. */
export function validateProfileTabs(page) {
  if (!profilePageTypes.has(page.type)) return;
  const ids = new Set();
  for (const section of page.sections || []) {
    if (typeof section.id !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(section.id)) {
      throw new Error(`Profile ${page.id}: section "${section.title}" needs a stable kebab-case id`);
    }
    if (ids.has(section.id)) {
      throw new Error(`Profile ${page.id}: duplicate section id "${section.id}"`);
    }
    ids.add(section.id);
  }
}
