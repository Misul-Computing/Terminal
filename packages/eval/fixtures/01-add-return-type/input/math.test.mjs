import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./src/math.ts", import.meta.url), "utf8");
const normalized = src.replace(/\s+/g, " ").trim();

// The add function must declare an explicit number return type.
assert.match(normalized, /export function add\(a: number, b: number\)\s*: number\s*\{/, "add must have a `: number` return type");
// Behavior preserved.
assert.match(normalized, /return a \+ b;/, "add body must still be `return a + b;`");

console.log("01-add-return-type ok");
