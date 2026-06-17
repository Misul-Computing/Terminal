import assert from "node:assert/strict";

const mod = await import(new URL("./src/area.mjs", import.meta.url));

assert.equal(typeof mod.rectangleArea, "function", "must export rectangleArea");
assert.equal(mod.calc, undefined, "must not export calc anymore");
assert.equal(mod.rectangleArea(3, 4), 12, "rectangleArea(3,4) must be 12");
assert.equal(mod.describeArea(2, 5), "area=10", "describeArea(2,5) must be 'area=10'");

console.log("03-rename-symbol ok");
