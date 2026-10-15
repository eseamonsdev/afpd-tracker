import fs from "node:fs";

// JSON selects a named template within _includes/custom, never an arbitrary path.
export function customTemplatePath(name) {
  if (typeof name !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
    throw new Error(`Invalid custom template name: ${String(name)}`);
  }
  const template = `custom/${name}.njk`;
  if (!fs.existsSync(`src/_includes/${template}`)) {
    throw new Error(`Custom template not found: ${template}`);
  }
  return template;
}
