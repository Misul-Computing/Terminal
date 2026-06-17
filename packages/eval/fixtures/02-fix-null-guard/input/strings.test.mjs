import assert from "node:assert/strict";

const { firstChar } = await import(new URL("./src/strings.mjs", import.meta.url));

assert.equal(firstChar(null), "", "firstChar(null) must return empty string");
assert.equal(firstChar(undefined), "", "firstChar(undefined) must return empty string");
assert.equal(firstChar("abc"), "a", "firstChar('abc') must return 'a'");
assert.equal(firstChar("x"), "x", "firstChar('x') must return 'x'");

console.log("02-fix-null-guard ok");
