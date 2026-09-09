import fs from "node:fs";

export default function (eleventyConfig) {
  eleventyConfig.addGlobalData("root", () => {
    const json = fs.readFileSync("./root.json", "utf8");
    return JSON.parse(json);
  });

  eleventyConfig.addWatchTarget("./root.json");

  return {
    dir: {
      input: "src",
      output: "public"
    },
    templateFormats: ["njk"],
    htmlTemplateEngine: "njk"
  };
}
