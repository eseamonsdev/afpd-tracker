/**
 * Builds a flat lookup dictionary from loaded source JSON files.
 *
 * Each JSON file may contain one or more top-level arrays:
 *
 * {
 *   "files": [...],
 *   "news": [...]
 * }
 *
 * Every item in those arrays must have a unique, nonempty `id`.
 *
 * @param {Array<{ path: string, data: unknown }>} loadedFiles
 * @returns {Record<string, object>}
 */
export function buildByID(loadedFiles) {
  const byID = Object.create(null);
  const idLocations = new Map();

  for (const loadedFile of loadedFiles) {
    const { path: sourcePath, data } = loadedFile;

    if (
      data === null ||
      typeof data !== "object" ||
      Array.isArray(data)
    ) {
      throw new Error(
        `Expected the top level of ${sourcePath} to be a JSON object`
      );
    }

    for (const [collectionName, collection] of Object.entries(data)) {
      if (!Array.isArray(collection)) {
        throw new Error(
          `Expected "${collectionName}" in ${sourcePath} to be an array`
        );
      }

      for (const [index, item] of collection.entries()) {
        const itemLocation =
          `${sourcePath} → ${collectionName}[${index}]`;

        if (
          item === null ||
          typeof item !== "object" ||
          Array.isArray(item)
        ) {
          throw new Error(
            `Expected ${itemLocation} to be an object`
          );
        }

        if (
          typeof item.id !== "string" ||
          item.id.trim().length === 0
        ) {
          throw new Error(
            `Missing or invalid "id" in ${itemLocation}`
          );
        }

        const id = item.id.trim();

        if (Object.hasOwn(byID, id)) {
          const previousLocation = idLocations.get(id);

          throw new Error(
            `Duplicate id "${id}" found in ${itemLocation}; ` +
            `it was already defined in ${previousLocation}`
          );
        }

        byID[id] = item;
        idLocations.set(id, itemLocation);
      }
    }
  }

  return byID;
}
