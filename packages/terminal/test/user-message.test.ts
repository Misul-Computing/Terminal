import { describe, expect, test } from "vitest";
import { UserMessageComponent } from "../src/modes/interactive/components/user-message.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

const OSC133_ZONE_START = "\x1b]133;A\x07";
const OSC133_ZONE_END = "\x1b]133;B\x07";
const OSC133_ZONE_FINAL = "\x1b]133;C\x07";
const BG_RESET = "\x1b[49m";

describe("UserMessageComponent", () => {
	test("renders the user message with a background color and OSC zone markers", () => {
		initTheme("dark");

		const component = new UserMessageComponent("hello");
		const lines = component.render(20);
		const joined = lines.join("\n");

		expect(joined).toContain("hello");
		// OSC start marker on the first content line (has "hello").
		const startLine = lines.find((l) => l.includes("hello"));
		expect(startLine).toBeDefined();
		expect(startLine).toContain(OSC133_ZONE_START);
		// OSC end marker also on the last content line.
		expect(startLine).toContain(OSC133_ZONE_END + OSC133_ZONE_FINAL);
		// User messages now have a background color fill.
		expect(joined).toContain(BG_RESET);
	});
});
