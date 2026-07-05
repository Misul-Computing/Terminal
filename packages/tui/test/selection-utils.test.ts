import assert from "node:assert";
import { describe, it } from "node:test";
import { applyBackgroundToRange, stripAnsi } from "../src/utils.ts";

describe("applyBackgroundToRange", () => {
	it("applies background to a simple substring range", () => {
		const bg = "\x1b[48;2;0;0;255m";
		const resetBg = "\x1b[49m";
		const result = applyBackgroundToRange("hello world", 2, 7, bg, resetBg);
		// selected text is "llo w" (cols 2-7 in zero-indexed exclusive range)
		assert.strictEqual(result, `he${bg}llo w${resetBg}orld`);
	});

	it("preserves existing foreground color inside the selection", () => {
		const red = "\x1b[31m";
		const reset = "\x1b[39m";
		const bg = "\x1b[48;2;0;0;255m";
		const resetBg = "\x1b[49m";
		const line = `${red}hello world${reset}`;
		const result = applyBackgroundToRange(line, 2, 7, bg, resetBg);
		assert.ok(result.includes(red), "red foreground should remain");
		assert.ok(result.includes(bg), "background should be applied");
		assert.ok(result.includes(resetBg), "background should be reset");
	});

	it("returns the original line when range is empty", () => {
		const bg = "\x1b[48;2;0;0;255m";
		const resetBg = "\x1b[49m";
		const line = "hello";
		assert.strictEqual(applyBackgroundToRange(line, 0, 0, bg, resetBg), line);
		assert.strictEqual(applyBackgroundToRange(line, 3, 1, bg, resetBg), line);
	});

	it("applies background to the end of a line when endCol exceeds width", () => {
		const bg = "\x1b[48;2;0;0;255m";
		const resetBg = "\x1b[49m";
		const result = applyBackgroundToRange("hello", 2, Infinity, bg, resetBg);
		assert.strictEqual(result, `he${bg}llo${resetBg}`);
	});
});

describe("stripAnsi", () => {
	it("removes SGR color codes", () => {
		const red = "\x1b[31m";
		const reset = "\x1b[0m";
		assert.strictEqual(stripAnsi(`${red}hello${reset}`), "hello");
	});

	it("removes OSC 8 hyperlinks", () => {
		const url = "https://example.com";
		const line = `\x1b]8;;${url}\x1b\\link\x1b]8;;\x1b\\`;
		assert.strictEqual(stripAnsi(line), "link");
	});

	it("leaves plain text unchanged", () => {
		assert.strictEqual(stripAnsi("hello world"), "hello world");
	});
});
