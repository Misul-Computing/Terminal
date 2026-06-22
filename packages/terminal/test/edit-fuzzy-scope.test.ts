import { describe, expect, it } from "vitest";
import { applyEditsToNormalizedContent } from "../src/core/tools/edit-diff.ts";

describe("edit fuzzy matching scope", () => {
	it("does not rewrite Unicode outside the matched region", () => {
		// Line A has smart single quotes, so an ASCII-quoted oldText only matches
		// fuzzily. Line B has smart double quotes the edit never mentions; they must
		// survive byte-for-byte instead of being normalized away.
		const lineB = "const y = “bar”;";
		const content = `const x = ‘foo’;\n${lineB}\n`;

		const { newContent } = applyEditsToNormalizedContent(
			content,
			[{ oldText: "const x = 'foo';", newText: "const x = 'baz';" }],
			"demo.ts",
		);

		expect(newContent).toContain("const x = 'baz';");
		expect(newContent).toContain(lineB);
	});

	it("preserves an em-dash on an untouched line during a fuzzy edit", () => {
		const note = "// total — keep me";
		const content = `${note}\nconst greeting = ‘hi’;\n`;

		const { newContent } = applyEditsToNormalizedContent(
			content,
			[{ oldText: "const greeting = 'hi';", newText: "const greeting = 'hey';" }],
			"demo.ts",
		);

		expect(newContent).toContain("const greeting = 'hey';");
		expect(newContent).toContain(note);
	});
});
