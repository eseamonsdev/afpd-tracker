// Newest dates first; keep the source array's order within each date.
export function sortUpdates(updates) {
  return (Array.isArray(updates) ? updates : [])
    .map((update, index) => ({ update, index }))
    .sort((a, b) => String(b.update.publishedDate || "").localeCompare(String(a.update.publishedDate || "")) || a.index - b.index)
    .map(({ update }) => update);
}
