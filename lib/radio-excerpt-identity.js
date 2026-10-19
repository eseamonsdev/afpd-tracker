import fs from "node:fs";
import path from "node:path";

export function excerptUrl(excerpt) {
  if (typeof excerpt?.slug !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(excerpt.slug) || /^\d+$/.test(excerpt.slug)) {
    throw new Error(`Radio excerpt ${excerpt?.number}: a stable descriptive slug is required`);
  }
  return `/police-radio/excerpts/${excerpt.slug}/`;
}

export function validateExcerptIdentities(excerpts) {
  const slugs = new Set(), numbers = new Set();
  for (const excerpt of excerpts) {
    excerptUrl(excerpt);
    if (!Number.isSafeInteger(excerpt.number) || excerpt.number < 1 || numbers.has(excerpt.number)) throw new Error("Radio excerpt numbers must be unique positive integers");
    if (slugs.has(excerpt.slug)) throw new Error(`Duplicate radio excerpt slug: ${excerpt.slug}`);
    numbers.add(excerpt.number); slugs.add(excerpt.slug);
  }
  return true;
}

// Validate disabled excerpts too, so their permanent identities remain reserved.
export function validateRadioExcerptIdentities(directory = "data/entities/police-radio-excerpts") {
  const excerpts = fs.readdirSync(directory).filter(file => file.endsWith(".json")).sort().flatMap(file =>
    JSON.parse(fs.readFileSync(path.join(directory, file), "utf8")).entities
  );
  return validateExcerptIdentities(excerpts);
}
