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

describe("edit indentation-flexible matching", () => {
	it("matches a dedented block and reindents the replacement to the file's indentation", () => {
		const content = "function foo() {\n  const a = 1;\n  const b = 2;\n}\n";

		const { newContent } = applyEditsToNormalizedContent(
			content,
			[{ oldText: "const a = 1;\nconst b = 2;", newText: "const a = 10;\nconst b = 20;" }],
			"demo.ts",
		);

		expect(newContent).toBe("function foo() {\n  const a = 10;\n  const b = 20;\n}\n");
	});

	it("preserves relative indentation when reindenting", () => {
		const content = "class C {\n    method() {\n        return 1;\n    }\n}\n";

		const { newContent } = applyEditsToNormalizedContent(
			content,
			[{ oldText: "method() {\n    return 1;\n}", newText: "method() {\n    return 2;\n}" }],
			"demo.ts",
		);

		expect(newContent).toBe("class C {\n    method() {\n        return 2;\n    }\n}\n");
	});

	it("refuses to guess when a dedented block is ambiguous", () => {
		// The block "a()\nb()" appears at two different indentations; reindenting is
		// ambiguous, so the edit must fail rather than silently pick one.
		const content = "  a()\n  b()\n    a()\n    b()\n";

		expect(() =>
			applyEditsToNormalizedContent(content, [{ oldText: "a()\nb()", newText: "a()\nc()" }], "demo.ts"),
		).toThrow();
	});
});
