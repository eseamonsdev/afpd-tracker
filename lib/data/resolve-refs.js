/**
 * Recursively resolves $ref objects using a flat byID dictionary.
 *
 * Supported forms:
 *
 * { "$ref": "some-id" }
 *
 * { "$ref": "some-id", "$field": "label" }
 *
 * {
 *   "$ref": "some-id",
 *   "$override": {
 *     "label": "Context-specific label",
 *     "featured": true
 *   }
 * }
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
  const hasOverride = Object.hasOwn(value, "$override");

  if (hasField && !hasRef) {
    throw new Error(
      `Found "$field" without "$ref" at ${location}`
    );
  }

  if (hasOverride && !hasRef) {
    throw new Error(
      `Found "$override" without "$ref" at ${location}`
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
  const allowedKeys = new Set([
    "$ref",
    "$field",
    "$override"
  ]);

  const unexpectedKeys = Object.keys(reference).filter(
    key => !allowedKeys.has(key)
  );

  if (unexpectedKeys.length > 0) {
    throw new Error(
      `Reference object at ${location} contains unsupported ` +
      `field(s): ${unexpectedKeys.join(", ")}`
    );
  }

  const hasField = Object.hasOwn(reference, "$field");
  const hasOverride = Object.hasOwn(reference, "$override");

  if (hasField && hasOverride) {
    throw new Error(
      `Reference object at ${location} cannot contain both ` +
      `"$field" and "$override"`
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

  if (hasField) {
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

  const resolvedReferencedObject = resolveValue(
    referencedObject,
    byID,
    nextReferenceChain,
    `${location} → ${id}`
  );

  if (!hasOverride) {
    return resolvedReferencedObject;
  }

  const override = reference.$override;

  if (
    override === null ||
    typeof override !== "object" ||
    Array.isArray(override)
  ) {
    throw new Error(
      `Invalid "$override" at ${location}; expected an object`
    );
  }

  const forbiddenOverrideKeys = new Set([
    "id",
    "$ref",
    "$field",
    "$override"
  ]);

  const forbiddenKeys = Object.keys(override).filter(
    key => forbiddenOverrideKeys.has(key)
  );

  if (forbiddenKeys.length > 0) {
    throw new Error(
      `"$override" at ${location} cannot replace reserved ` +
      `field(s): ${forbiddenKeys.join(", ")}`
    );
  }

  const resolvedOverride = resolveValue(
    override,
    byID,
    nextReferenceChain,
    `${location}.$override`
  );

  if (
    resolvedReferencedObject === null ||
    typeof resolvedReferencedObject !== "object" ||
    Array.isArray(resolvedReferencedObject)
  ) {
    throw new Error(
      `Unable to apply "$override" at ${location}; ` +
      `"$ref" "${id}" did not resolve to an object`
    );
  }

  return {
    ...resolvedReferencedObject,
    ...resolvedOverride
  };
}
