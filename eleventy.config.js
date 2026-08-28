import fs from "node:fs";

export default function (eleventyConfig) {
  eleventyConfig.addGlobalData("repository", () => {
    const json = fs.readFileSync("./repository.json", "utf8");
    return JSON.parse(json);
  });

  eleventyConfig.addWatchTarget("./repository.json");

  return {
    dir: {
      input: "src",
      output: "public"
    },
    templateFormats: ["njk"],
    htmlTemplateEngine: "njk"
  };
}
