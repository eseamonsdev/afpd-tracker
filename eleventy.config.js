import fs from "node:fs";

import { loadJsonFiles } from "./lib/data/load-json-files.js";
import { buildByID } from "./lib/data/build-by-id.js";
import { resolveRefs } from "./lib/data/resolve-refs.js";

export default function (eleventyConfig) {
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
      throw new Error(
        `Unable to load root.json: ${error.message}`,
        { cause: error }
      );
    }

    return resolveRefs(root, byID);
  });

  eleventyConfig.addWatchTarget("./root.json");
  eleventyConfig.addWatchTarget("./data/sources");
  eleventyConfig.addWatchTarget("./data/entities");

  return {
    dir: {
      input: "src",
      output: "public"
    },
    templateFormats: ["njk"],
    htmlTemplateEngine: "njk"
  };
}
