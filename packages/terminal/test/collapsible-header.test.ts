import { describe, expect, test } from "vitest";
import { CollapsibleHeader } from "../src/modes/interactive/components/collapsible-header.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

describe("CollapsibleHeader", () => {
	test("shows minus marker when expanded", () => {
		initTheme("dark");
		const header = new CollapsibleHeader("Thinking", true);
		header.render(80);
		// The text should contain "− Thinking" (minus = expanded/visible)
		expect(header.isExpanded()).toBe(true);
	});

	test("shows plus marker when collapsed", () => {
		const header = new CollapsibleHeader("Thinking", false);
		header.render(80);
		expect(header.isExpanded()).toBe(false);
	});

	test("setExpanded toggles the marker", () => {
		const header = new CollapsibleHeader("Tool", false);
		expect(header.isExpanded()).toBe(false);
		header.setExpanded(true);
		expect(header.isExpanded()).toBe(true);
		header.setExpanded(false);
		expect(header.isExpanded()).toBe(false);
	});

	test("setSelected changes the visual style", () => {
		const header = new CollapsibleHeader("Thinking", true);
		expect(header.isSelected()).toBe(false);
		header.setSelected(true);
		expect(header.isSelected()).toBe(true);
		header.setSelected(false);
		expect(header.isSelected()).toBe(false);
	});

	test("renders without errors for various labels", () => {
		const labels = ["Thinking", "edit_file", "bash", "Read", "Write"];
		for (const label of labels) {
			const header = new CollapsibleHeader(label, true);
			const lines = header.render(80);
			expect(lines.length).toBeGreaterThan(0);
		}
	});
});
