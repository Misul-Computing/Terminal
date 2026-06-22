import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, summary, wrapLabel } from "./index.mjs";

// The new name must be exported and work end-to-end through every call site.
assert.equal(typeof wrapLabel, "function", "wrapLabel must be exported from index.mjs");
assert.equal(render(["a", "b"]), "[a] [b]", "render must work via the renamed function");
assert.equal(summary("x"), "Summary [x]", "summary must work via the renamed function");

// The old name must be gone from every source file (completeness; blocks aliasing).
for (const f of ["src/format.mjs", "src/render.mjs", "src/summary.mjs", "index.mjs"]) {
	const text = readFileSync(new URL(`./${f}`, import.meta.url), "utf8");
	assert.ok(!/formatLabel/.test(text), `old name 'formatLabel' must not remain in ${f}`);
}

console.log("06-cross-file-rename ok");
