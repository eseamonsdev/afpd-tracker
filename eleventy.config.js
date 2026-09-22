import fs from "node:fs";
import { loadJsonFiles } from "./lib/data/load-json-files.js";
import { buildByID } from "./lib/data/build-by-id.js";
import { resolveRefs } from "./lib/data/resolve-refs.js";
import { readCsv } from "./lib/data/read-csv.js";

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

export default function (eleventyConfig) {
  eleventyConfig.addFilter("readCsv", readCsv);

  eleventyConfig.addFilter("formatCurrency", (value) => {
    if (value === null || value === undefined) {
      return "";
    }

    const text = String(value).trim();

    if (text === "") {
      return "";
    }

    const number = Number(text);

    if (!Number.isFinite(number)) {
      return value;
    }

    return currencyFormatter.format(number);
  });

  eleventyConfig.addGlobalData("root", () => {
    const loadedSourceFiles = loadJsonFiles("./data/sources");
    const loadedEntityFiles = loadJsonFiles("./data/entities");

    const byID = buildByID([
      ...loadedSourceFiles,
      ...loadedEntityFiles
    ]);

    let root;

    try {
      const json = fs.readFileSync("./root.json", "utf8");
      root = JSON.parse(json);
    } catch (error) {
      throw new Error(`Unable to load root.json: ${error.message}`, {
        cause: error
      });
    }

    return resolveRefs(root, byID);
  });

  eleventyConfig.addGlobalData("entities", () => {
    const loadedSourceFiles = loadJsonFiles("./data/sources");
    const loadedEntityFiles = loadJsonFiles("./data/entities");

    // References can point to sources or entities.
    const byID = buildByID([
      ...loadedSourceFiles,
      ...loadedEntityFiles
    ]);

    // Only entities are exposed in these groups.
    const entityByID = buildByID(loadedEntityFiles);

    const all = Object.create(null);
    const byType = Object.create(null);

    for (const [id, entity] of Object.entries(entityByID)) {
      const resolvedEntity = resolveRefs(entity, byID);

      all[id] = resolvedEntity;

      const type = resolvedEntity.type;

      if (typeof type === "string" && type.length > 0) {
        if (!byType[type]) {
          byType[type] = [];
        }

        byType[type].push(resolvedEntity);
      }
    }

    return { all, byType };
  });

  eleventyConfig.addWatchTarget("./root.json");
  eleventyConfig.addWatchTarget("./data/sources");
  eleventyConfig.addWatchTarget("./data/entities");
  eleventyConfig.addWatchTarget("./public/records/**/*.csv");

  return {
    dir: {
      input: "src",
      output: "public"
    },
    templateFormats: ["njk"],
    htmlTemplateEngine: "njk"
  };
}
