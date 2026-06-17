import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { circleArea } = await import(new URL("./src/circle.mjs", import.meta.url));
assert.ok(Math.abs(circleArea(2) - 3.14159 * 4) < 1e-9, "circleArea(2) must equal PI*4");
assert.ok(Math.abs(circleArea(0)) < 1e-12, "circleArea(0) must be 0");

const src = readFileSync(new URL("./src/circle.mjs", import.meta.url), "utf8");
const normalized = src.replace(/\s+/g, " ").trim();
assert.match(normalized, /const PI = 3\.14159;/, "must declare `const PI = 3.14159;`");
assert.match(normalized, /return PI \* r \* r;/, "circleArea must use the PI constant");

console.log("05-extract-constant ok");
