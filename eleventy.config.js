import fs from "node:fs";

export default function (eleventyConfig) {
  eleventyConfig.addGlobalData("root", () => {
    const json = fs.readFileSync("./src/_data/root.json", "utf8");
    return JSON.parse(json);
  });

  eleventyConfig.addWatchTarget("./src/_data/root.json");

  return {
    dir: {
      input: "src",
      output: "public"
    },
    templateFormats: ["njk"],
    htmlTemplateEngine: "njk"
  };
}
