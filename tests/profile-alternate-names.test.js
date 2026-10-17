import assert from "node:assert/strict";
import test from "node:test";
import { profileAlternateNames } from "../lib/profile-alternate-names.js";

function profile(name, alternatives, description) {
  return { name, alternate_names: alternatives, sections: [{ title: "Overview", descriptions: [description] }] };
}

test("hides names already used in overview without changing the profile", () => {
  const page = profile("Holley, Timothy A.", ["Tim Holley", "Timothy Andrew Holley"], "Councilmember Tim Holley spoke.");
  const before = structuredClone(page);
  assert.deepEqual(profileAlternateNames(page), ["Timothy Andrew Holley"]);
  assert.deepEqual(page, before);
});

test("retains first and last only when overview uses middle initials", () => {
  assert.deepEqual(profileAlternateNames(profile("Lott, Shawn E.", ["Shawn Lott", "Shawn Elton Lott"], "Shawn E. Lott serves as a sergeant.")), ["Shawn Lott", "Shawn Elton Lott"]);
});

test("normalizes header order, case and initial punctuation", () => {
  assert.deepEqual(profileAlternateNames(profile("Carroll, Staci V.", ["Staci V Carroll", "Staci Carroll", "STACI CARROLL"], "Staci Carroll is a councilmember.")), []);
});

test("recognizes names split across linked text segments", () => {
  const page = profile("Nordin, Suzanne M.", ["Suzanne Michelle Smith"], "");
  page.sections[0].contents = [{ type: "formatted-text", segments: [{ text: "Previously " }, { text: "Suzanne Michelle Smith", format: "link", url: "/example/" }, { text: "." }] }];
  assert.deepEqual(profileAlternateNames(page), []);
});

test("a shorter form within a longer name is not a standalone overview mention", () => {
  assert.deepEqual(profileAlternateNames(profile("Blackburn, Christopher Slate", ["Slate Blackburn", "C. Slate Blackburn"], "Christopher Slate Blackburn was an officer.")), ["Slate Blackburn", "C. Slate Blackburn"]);
});

test("other sections and unpublished overviews do not suppress alternatives", () => {
  const page = profile("Frost, Jodi A.", ["Jodi Anderson"], "Jodi A. Frost worked for the department.");
  page.sections.push({ title: "Employment", descriptions: ["Jodi Anderson"] }, { title: "Overview", published: false, descriptions: ["Jodi Anderson"] });
  assert.deepEqual(profileAlternateNames(page), ["Jodi Anderson"]);
});
