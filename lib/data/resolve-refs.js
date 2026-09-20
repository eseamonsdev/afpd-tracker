/**
 * Recursively resolves $ref objects using a flat byID dictionary.
 *
 * Supported forms:
 *
 * { "$ref": "some-id" }
 *
 * { "$ref": "some-id", "$path": ["label"] }
 *
 * { "$ref": "some-id", "$path": ["employment", 0, "agency"] }
 *
 * { "$ref": "some-id", "$path": ["items"], "$spread": true }
 *
 * {
 *   "$ref": "some-id",
 *   "$override": {
 *     "label": "Context-specific label"
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
    const resolvedArray = [];

    for (const [index, item] of value.entries()) {
      const itemLocation = `${location}[${index}]`;

      const shouldSpread =
        item !== null &&
        typeof item === "object" &&
        !Array.isArray(item) &&
        item.$spread === true;

      const resolvedItem = resolveValue(
        item,
        byID,
        referenceChain,
        itemLocation
      );

      if (shouldSpread) {
        if (!Array.isArray(resolvedItem)) {
          throw new Error(
            `Unable to spread value at ${itemLocation}; ` +
            `expected the reference to resolve to an array`
          );
        }

        resolvedArray.push(...resolvedItem);
      } else {
        resolvedArray.push(resolvedItem);
      }
    }

    return resolvedArray;
  }

  const hasRef = Object.hasOwn(value, "$ref");
  const hasPath = Object.hasOwn(value, "$path");
  const hasOverride = Object.hasOwn(value, "$override");
  const hasSpread = Object.hasOwn(value, "$spread");

  if (hasPath && !hasRef) {
    throw new Error(
      `Found "$path" without "$ref" at ${location}`
    );
  }

  if (hasOverride && !hasRef) {
    throw new Error(
      `Found "$override" without "$ref" at ${location}`
    );
  }

  if (hasSpread && !hasRef) {
    throw new Error(
      `Found "$spread" without "$ref" at ${location}`
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
    "$path",
    "$override",
    "$spread"
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

  const hasPath = Object.hasOwn(reference, "$path");
  const hasOverride = Object.hasOwn(reference, "$override");
  const hasSpread = Object.hasOwn(reference, "$spread");

  if (hasSpread && reference.$spread !== true) {
    throw new Error(
      `Invalid "$spread" at ${location}; expected true`
    );
  }

  if (hasPath && hasOverride) {
    throw new Error(
      `Reference object at ${location} cannot contain both ` +
      `"$path" and "$override"`
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

  if (hasPath) {
    const path = reference.$path;

    if (!Array.isArray(path) || path.length === 0) {
      throw new Error(
        `Invalid "$path" at ${location}; expected a nonempty array`
      );
    }

    let selectedValue = referencedObject;
    let selectedLocation = `${location} → ${id}`;

    for (const [index, segment] of path.entries()) {
      const isKey = typeof segment === "string";
      const isIndex = Number.isSafeInteger(segment) && segment >= 0;

      if (!isKey && !isIndex) {
        throw new Error(
          `Invalid "$path" segment at ${location}.$path[${index}]; ` +
          `expected a string or nonnegative safe integer`
        );
      }

      if (selectedValue === null || typeof selectedValue !== "object") {
        throw new Error(
          `Unable to traverse "$path" at ${selectedLocation}; ` +
          `expected an object or array`
        );
      }

      if (Array.isArray(selectedValue) ? !isIndex : !isKey) {
        throw new Error(
          `Invalid "$path" segment at ${location}.$path[${index}]; ` +
          `arrays require numeric indices and objects require string keys`
        );
      }

      const nextLocation =
        `${selectedLocation}[${JSON.stringify(segment)}]`;

      if (!Object.hasOwn(selectedValue, segment)) {
        throw new Error(
          `Unable to resolve "$path" at ${nextLocation}; ` +
          `property or array index does not exist`
        );
      }

      selectedValue = selectedValue[segment];
      selectedLocation = nextLocation;
    }

    return resolveValue(
      selectedValue,
      byID,
      nextReferenceChain,
      selectedLocation
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
    "$path",
    "$override",
    "$spread"
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
