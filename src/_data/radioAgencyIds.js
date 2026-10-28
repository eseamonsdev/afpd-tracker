import fs from "node:fs";

export default function () {
  return JSON.parse(fs.readFileSync("public/records/openmhz/radio-agency-identifiers.json", "utf8"));
}
