import { describe, expect, test } from "vitest";
import { UserMessageComponent } from "../src/modes/interactive/components/user-message.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

const OSC133_ZONE_START = "\x1b]133;A\x07";
const OSC133_ZONE_END = "\x1b]133;B\x07";
const OSC133_ZONE_FINAL = "\x1b]133;C\x07";
const BG_RESET = "\x1b[49m";

describe("UserMessageComponent", () => {
	test("renders the user message boxless (no colored background) with OSC zone markers", () => {
		initTheme("dark");

		const component = new UserMessageComponent("hello");
		const lines = component.render(20);
		const joined = lines.join("\n");

		expect(joined).toContain("hello");
		expect(lines[0]).toContain(OSC133_ZONE_START);
		expect(lines[lines.length - 1]).toContain(OSC133_ZONE_END + OSC133_ZONE_FINAL);
		// No big colored box: no background fill/reset sequence anywhere.
		expect(joined).not.toContain(BG_RESET);
	});
});
