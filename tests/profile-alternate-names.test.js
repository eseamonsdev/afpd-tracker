import assert from "node:assert/strict";
import test from "node:test";
import { profileAlternateNames, profileDisplayName } from "../lib/profile-alternate-names.js";

test("keeps listed alternatives even when the Overview mentions them", () => {
  const page = {
    name: "Holley, Timothy A.",
    alternate_names: ["Tim Holley", "Timothy Andrew Holley"],
    sections: [{ title: "Overview", descriptions: ["Councilmember Tim Holley spoke."] }]
  };
  const before = structuredClone(page);
  assert.deepEqual(profileAlternateNames(page), ["Tim Holley", "Timothy Andrew Holley"]);
  assert.deepEqual(page, before);
});

test("omits only the chosen header form, regardless of name order or punctuation", () => {
  const page = {
    name: "Carroll, Staci V.",
    display_name: "Staci V. Carroll",
    alternate_names: ["Staci V Carroll", "Staci Carroll", "Staci Victoria Carroll"]
  };
  assert.equal(profileDisplayName(page), "Staci V. Carroll");
  assert.deepEqual(profileAlternateNames(page), ["Staci Carroll", "Staci Victoria Carroll"]);
});

test("renders the profile header in natural order while preserving the alternate list", () => {
  const page = {
    name: "Sumbot, Luke A.",
    alternate_names: ["Luke A. Sumbot", "Luke Anthony Sumbot", "Luke Sumbot"],
    sections: [{ title: "Overview", descriptions: ["Luke Anthony Sumbot investigated the complaint."] }]
  };
  assert.equal(profileDisplayName(page), "Luke A. Sumbot");
  assert.deepEqual(profileAlternateNames(page), ["Luke Anthony Sumbot", "Luke Sumbot"]);
});

test("keeps every supplied distinct alternate without reading other sections", () => {
  const page = {
    name: "Frost, Jodi A.",
    alternate_names: ["Jodi Anderson", "Jodi Anderson Frost"],
    sections: [{ title: "Employment", descriptions: ["Jodi Anderson worked for the department."] }]
  };
  assert.deepEqual(profileAlternateNames(page), ["Jodi Anderson", "Jodi Anderson Frost"]);
});
