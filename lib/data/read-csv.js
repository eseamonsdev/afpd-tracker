import fs from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";

export function readCsv(recordPath) {
  if (typeof recordPath !== "string" || recordPath.trim() === "") {
    throw new Error("CSV table requires a nonempty file path.");
  }

  const recordsDirectory = path.resolve("public/records");
  const filePath = path.resolve(recordsDirectory, recordPath);
  const relativePath = path.relative(recordsDirectory, filePath);

  if (
    relativePath === "" ||
    relativePath === ".." ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error(
      `CSV path must point to a file inside public/records: ${recordPath}`
    );
  }

  if (path.extname(filePath).toLowerCase() !== ".csv") {
    throw new Error(
      `Table display currently supports only CSV files: ${recordPath}`
    );
  }

  try {
    const text = fs.readFileSync(filePath, "utf8");

    const records = parse(text, {
      bom: true,
      skip_empty_lines: true
    });

    const headers = records.length > 0 ? records[0] : [];
    const rows = records.slice(1);

    const downloadUrl = "/records/" + relativePath
      .split(path.sep)
      .map((segment) => encodeURIComponent(segment))
      .join("/");

    return {
      headers,
      rows,
      downloadUrl
    };
  } catch (error) {
    throw new Error(
      `Unable to read CSV "${recordPath}": ${error.message}`,
      { cause: error }
    );
  }
}
