import assert from "node:assert/strict";

const { divide } = await import(new URL("./src/divide.mjs", import.meta.url));

assert.equal(divide(10, 2), 5, "divide(10,2) must be 5");
assert.equal(divide(9, 3), 3, "divide(9,3) must be 3");
assert.throws(
	() => divide(1, 0),
	(err) => err instanceof Error && err.message === "division by zero",
	"divide(1,0) must throw Error('division by zero')",
);

console.log("04-add-error-case ok");
