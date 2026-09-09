import fs from "node:fs";
import path from "node:path";

/**
 * Recursively loads every JSON file under a directory.
 *
 * @param {string} directoryPath
 * @returns {Array<{ path: string, data: unknown }>}
 */
export function loadJsonFiles(directoryPath) {
  const absoluteDirectoryPath = path.resolve(directoryPath);

  if (!fs.existsSync(absoluteDirectoryPath)) {
    throw new Error(
      `JSON data directory does not exist: ${absoluteDirectoryPath}`
    );
  }

  if (!fs.statSync(absoluteDirectoryPath).isDirectory()) {
    throw new Error(
      `JSON data path is not a directory: ${absoluteDirectoryPath}`
    );
  }

  const loadedFiles = [];

  function walk(currentDirectoryPath) {
    const entries = fs
      .readdirSync(currentDirectoryPath, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const entryPath = path.join(currentDirectoryPath, entry.name);

      if (entry.isDirectory()) {
        walk(entryPath);
        continue;
      }

      if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".json") {
        continue;
      }

      let data;

      try {
        const json = fs.readFileSync(entryPath, "utf8");
        data = JSON.parse(json);
      } catch (error) {
        throw new Error(
          `Unable to parse JSON file ${entryPath}: ${error.message}`,
          { cause: error }
        );
      }

      loadedFiles.push({
        path: entryPath,
        data
      });
    }
  }

  walk(absoluteDirectoryPath);

  return loadedFiles;
}
