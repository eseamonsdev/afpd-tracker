/**
 * Recursively resolves $ref objects using a flat byID dictionary.
 *
 * Supported forms:
 *
 * { "$ref": "some-id" }
 *
 * { "$ref": "some-id", "$field": "label" }
 *
 * @param {unknown} value
 * @param {Record<string, object>} byID
 * @returns {unknown}
 */
export function resolveRefs(value, byID) {
  return resolveValue(value, byID, [], "$");
}

/**
 * @param {unknown} value
 * @param {Record<string, object>} byID
 * @param {string[]} referenceChain
 * @param {string} location
 * @returns {unknown}
 */
function resolveValue(value, byID, referenceChain, location) {
  if (value === null || typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item, index) =>
      resolveValue(
        item,
        byID,
        referenceChain,
        `${location}[${index}]`
      )
    );
  }

  const hasRef = Object.hasOwn(value, "$ref");
  const hasField = Object.hasOwn(value, "$field");

  if (hasField && !hasRef) {
    throw new Error(
      `Found "$field" without "$ref" at ${location}`
    );
  }

  if (hasRef) {
    return resolveReference(
      value,
      byID,
      referenceChain,
      location
    );
  }

  const resolvedObject = {};

  for (const [key, childValue] of Object.entries(value)) {
    resolvedObject[key] = resolveValue(
      childValue,
      byID,
      referenceChain,
      `${location}.${key}`
    );
  }

  return resolvedObject;
}

/**
 * @param {object} reference
 * @param {Record<string, object>} byID
 * @param {string[]} referenceChain
 * @param {string} location
 * @returns {unknown}
 */
function resolveReference(
  reference,
  byID,
  referenceChain,
  location
) {
  const allowedKeys = new Set(["$ref", "$field"]);
  const unexpectedKeys = Object.keys(reference).filter(
    key => !allowedKeys.has(key)
  );

  if (unexpectedKeys.length > 0) {
    throw new Error(
      `Reference object at ${location} contains unsupported ` +
      `field(s): ${unexpectedKeys.join(", ")}`
    );
  }

  const referenceID = reference.$ref;

  if (
    typeof referenceID !== "string" ||
    referenceID.trim().length === 0
  ) {
    throw new Error(
      `Invalid "$ref" at ${location}; expected a nonempty string`
    );
  }

  const id = referenceID.trim();

  if (!Object.hasOwn(byID, id)) {
    throw new Error(
      `Unable to resolve "$ref" "${id}" at ${location}`
    );
  }

  if (referenceChain.includes(id)) {
    const cycle = [...referenceChain, id].join(" → ");

    throw new Error(
      `Circular reference detected at ${location}: ${cycle}`
    );
  }

  const nextReferenceChain = [...referenceChain, id];
  const referencedObject = byID[id];

  if (Object.hasOwn(reference, "$field")) {
    const field = reference.$field;

    if (
      typeof field !== "string" ||
      field.trim().length === 0
    ) {
      throw new Error(
        `Invalid "$field" at ${location}; expected a nonempty string`
      );
    }

    const fieldName = field.trim();

    if (!Object.hasOwn(referencedObject, fieldName)) {
      throw new Error(
        `Unable to resolve field "${fieldName}" from ` +
        `"$ref" "${id}" at ${location}`
      );
    }

    return resolveValue(
      referencedObject[fieldName],
      byID,
      nextReferenceChain,
      `${location} → ${id}.${fieldName}`
    );
  }

  return resolveValue(
    referencedObject,
    byID,
    nextReferenceChain,
    `${location} → ${id}`
  );
}
