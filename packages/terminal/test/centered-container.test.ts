import type { Component } from "@misul/tui";
import { describe, expect, test } from "vitest";
import { CenteredContainer } from "../src/modes/interactive/components/centered-container.ts";

// Stub component that returns fixed lines verbatim, so we can assert exactly how
// CenteredContainer pads and widths them.
class StubComponent implements Component {
	private readonly lines: string[];
	constructor(lines: string[]) {
		this.lines = lines;
	}
	invalidate(): void {}
	render(width: number): string[] {
		// Echo the width we were rendered at as the first line, then the fixed lines.
		return [`w=${width}`, ...this.lines];
	}
}

const OSC = "\x1b]133;A\x07";

describe("CenteredContainer", () => {
	test("renders children at the reduced content width and centers them", () => {
		const c = new CenteredContainer(120);
		c.addChild(new StubComponent(["hello", "world"]));

		const lines = c.render(200);

		// width 200, maxWidth 120 -> children rendered at 120, leftPad = (200-120)/2 = 40
		expect(lines[0]).toBe(" ".repeat(40) + "w=120");
		expect(lines[1]).toBe(" ".repeat(40) + "hello");
		expect(lines[2]).toBe(" ".repeat(40) + "world");
	});

	test("does not pad or shrink when viewport is narrower than maxWidth", () => {
		const c = new CenteredContainer(120);
		c.addChild(new StubComponent(["hi"]));

		const lines = c.render(80);

		// width 80 < 120 -> contentWidth = 80, leftPad = 0 -> verbatim, no padding
		expect(lines[0]).toBe("w=80");
		expect(lines[1]).toBe("hi");
	});

	test("inserts padding after leading ANSI escape sequences (OSC 133 markers stay at column 0)", () => {
		const c = new CenteredContainer(120);
		c.addChild(new StubComponent([`${OSC}hello`]));

		const lines = c.render(200);

		// The OSC marker must remain at the start of the line (column 0), with the
		// centering padding inserted after it, so terminal zone detection is preserved.
		expect(lines[1].startsWith(OSC)).toBe(true);
		expect(lines[1]).toBe(OSC + " ".repeat(40) + "hello");
	});

	test("leaves blank lines blank (no trailing/leading spaces added)", () => {
		const c = new CenteredContainer(120);
		c.addChild(new StubComponent(["", "x"]));

		const lines = c.render(200);

		expect(lines[1]).toBe("");
		expect(lines[2]).toBe(" ".repeat(40) + "x");
	});

	test("handles maxWidth wider than viewport with no padding (odd-width safe)", () => {
		const c = new CenteredContainer(120);
		c.addChild(new StubComponent(["x"]));

		const lines = c.render(121);

		// width 121, contentWidth = 120, leftPad = floor((121-120)/2) = 0 -> no pad
		expect(lines[0]).toBe("w=120");
		expect(lines[1]).toBe("x");
	});
});
