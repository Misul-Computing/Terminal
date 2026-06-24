import { setKeybindings } from "@misul/tui";
import { stripVTControlCharacters } from "node:util";
import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { KeybindingsManager } from "../src/core/keybindings.ts";
import { ThinkingBrowserComponent } from "../src/modes/interactive/components/thinking-browser.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

const UP = "\x1b[A";
const DOWN = "\x1b[B";
const ENTER = "\r";
const ESC = "\x1b";

beforeAll(() => {
	initTheme("dark");
});

beforeEach(() => {
	// Keybindings are a global singleton; reset to defaults for test isolation.
	setKeybindings(new KeybindingsManager());
});

function plain(lines: string[]): string[] {
	return lines.map((l) => stripVTControlCharacters(l));
}

describe("ThinkingBrowserComponent", () => {
	test("renders an empty-state message when there are no thinking traces", () => {
		const browser = new ThinkingBrowserComponent([]);
		const text = plain(browser.render(80)).join("\n");

		expect(text).toContain("No thinking traces in this session yet.");
	});

	test("lists every thinking trace and starts the cursor on the first", () => {
		const entries = [
			{ model: "glm-5.2", thinking: "first trace" },
			{ model: "glm-5.2", thinking: "second trace" },
			{ model: "kimi-k2", thinking: "third trace" },
		];
		const browser = new ThinkingBrowserComponent(entries);
		const text = plain(browser.render(80)).join("\n");

		expect(text).toContain("#1");
		expect(text).toContain("#2");
		expect(text).toContain("#3");
		// Cursor on the first entry.
		expect(text).toContain("(1/3)");
	});

	test("cursor moves down and wraps from last back to first", () => {
		const entries = [
			{ model: "a", thinking: "t1" },
			{ model: "b", thinking: "t2" },
			{ model: "c", thinking: "t3" },
		];
		const browser = new ThinkingBrowserComponent(entries);

		browser.handleInput(DOWN);
		expect(plain(browser.render(80)).join("\n")).toContain("(2/3)");

		browser.handleInput(DOWN);
		expect(plain(browser.render(80)).join("\n")).toContain("(3/3)");

		// Wrap: last -> first.
		browser.handleInput(DOWN);
		expect(plain(browser.render(80)).join("\n")).toContain("(1/3)");
	});

	test("cursor moves up and wraps from first to last", () => {
		const entries = [
			{ model: "a", thinking: "t1" },
			{ model: "b", thinking: "t2" },
		];
		const browser = new ThinkingBrowserComponent(entries);

		browser.handleInput(UP);
		expect(plain(browser.render(80)).join("\n")).toContain("(2/2)");
	});

	test("enter expands the selected trace, showing its text; enter again collapses it", () => {
		const entries = [{ model: "glm-5.2", thinking: "the model reasoned about the bug carefully" }];
		const browser = new ThinkingBrowserComponent(entries);

		// Collapsed by default: the trace text is not shown.
		let text = plain(browser.render(80)).join("\n");
		expect(text).not.toContain("the model reasoned about the bug carefully");

		// Expand.
		browser.handleInput(ENTER);
		text = plain(browser.render(80)).join("\n");
		expect(text).toContain("the model reasoned about the bug carefully");

		// Collapse.
		browser.handleInput(ENTER);
		text = plain(browser.render(80)).join("\n");
		expect(text).not.toContain("the model reasoned about the bug carefully");
	});

	test("escape invokes onCancel", () => {
		const browser = new ThinkingBrowserComponent([{ model: "a", thinking: "t" }]);
		const onCancel = vi.fn();
		browser.onCancel = onCancel;

		browser.handleInput(ESC);
		expect(onCancel).toHaveBeenCalledOnce();
	});
});
