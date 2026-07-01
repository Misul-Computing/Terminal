import { describe, expect, test } from "vitest";
import { UserMessageComponent } from "../src/modes/interactive/components/user-message.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

const OSC133_ZONE_START = "\x1b]133;A\x07";
const OSC133_ZONE_END = "\x1b]133;B\x07";
const OSC133_ZONE_FINAL = "\x1b]133;C\x07";

const visibleWidth = (line: string): number =>
	line.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b\][^\x07]*\x07/g, "").length;

describe("UserMessageComponent", () => {
	test("renders the user message in a rounded border box with OSC zone markers", () => {
		initTheme("dark");

		const lines = new UserMessageComponent("hello").render(20);
		const joined = lines.join("\n");

		expect(joined).toContain("hello");

		// Rounded border box: top, bottom, and side rails.
		expect(lines[0]).toContain("╭");
		expect(lines[0]).toContain("╮");
		expect(lines[lines.length - 1]).toContain("╰");
		expect(lines[lines.length - 1]).toContain("╯");
		expect(lines.some((l) => l.includes("│"))).toBe(true);

		// OSC zone wraps the whole box: start on the top line, end on the bottom.
		expect(lines[0]).toContain(OSC133_ZONE_START);
		expect(lines[lines.length - 1]).toContain(OSC133_ZONE_END + OSC133_ZONE_FINAL);

		// Every row is the same visible width (a clean rectangle, not a staircase).
		// The box hugs content: "hello" is 5 chars, box is 9 wide (5 + 4 padding),
		// centered in 20 cols = 5 leftPad + 9 = 14 visible width per line.
		const widths = new Set(lines.map(visibleWidth));
		expect(widths.size).toBe(1);
		expect([...widths][0]).toBe(14);
	});
});
