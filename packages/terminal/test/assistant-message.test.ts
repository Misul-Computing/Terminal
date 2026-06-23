import type { AssistantMessage } from "@misul/ai";
import { describe, expect, test, vi } from "vitest";
import { AssistantMessageComponent } from "../src/modes/interactive/components/assistant-message.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

const OSC133_ZONE_START = "\x1b]133;A\x07";
const OSC133_ZONE_END = "\x1b]133;B\x07";
const OSC133_ZONE_FINAL = "\x1b]133;C\x07";

function createAssistantMessage(content: AssistantMessage["content"]): AssistantMessage {
	return {
		role: "assistant",
		content,
		api: "openai-responses",
		provider: "openai",
		model: "gpt-4o-mini",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

describe("AssistantMessageComponent", () => {
	test("adds OSC 133 zone markers to assistant messages without tool calls", () => {
		initTheme("dark");

		const component = new AssistantMessageComponent(createAssistantMessage([{ type: "text", text: "hello" }]));
		const lines = component.render(40);

		expect(lines).not.toHaveLength(0);
		expect(lines[0]).toContain(OSC133_ZONE_START);
		expect(lines[lines.length - 1].startsWith(OSC133_ZONE_END + OSC133_ZONE_FINAL)).toBe(true);
	});

	test("does not add OSC 133 zone markers when assistant message contains tool calls", () => {
		initTheme("dark");

		const component = new AssistantMessageComponent(
			createAssistantMessage([
				{ type: "text", text: "calling tool" },
				{ type: "toolCall", id: "tool-1", name: "read", arguments: { path: "file.txt" } },
			]),
		);
		const rendered = component.render(60).join("\n");

		expect(rendered.includes(OSC133_ZONE_START)).toBe(false);
		expect(rendered.includes(OSC133_ZONE_END)).toBe(false);
		expect(rendered.includes(OSC133_ZONE_FINAL)).toBe(false);
	});

	// Spy on the private content container's clear(), which only runs on a real rebuild.
	const clearSpy = (component: AssistantMessageComponent) =>
		vi.spyOn((component as unknown as { contentContainer: { clear: () => void } }).contentContainer, "clear");

	test("skips the markdown rebuild when content is unchanged (e.g. layout invalidate)", () => {
		initTheme("dark");
		const component = new AssistantMessageComponent(createAssistantMessage([{ type: "text", text: "hello" }]));
		const spy = clearSpy(component);

		// Same content as a fresh object — the resize/redraw case. Must not re-parse.
		component.updateContent(createAssistantMessage([{ type: "text", text: "hello" }]));
		expect(spy).not.toHaveBeenCalled();
	});

	test("rebuilds when streamed content grows", () => {
		initTheme("dark");
		const component = new AssistantMessageComponent(createAssistantMessage([{ type: "text", text: "hel" }]));
		const spy = clearSpy(component);

		component.updateContent(createAssistantMessage([{ type: "text", text: "hello world" }]));
		expect(spy).toHaveBeenCalledOnce();
	});

	test("rebuilds when the thinking-block display toggles", () => {
		initTheme("dark");
		const component = new AssistantMessageComponent(
			createAssistantMessage([{ type: "thinking", thinking: "pondering" }]),
		);
		const spy = clearSpy(component);

		component.setHideThinkingBlock(true);
		expect(spy).toHaveBeenCalledOnce();
	});
});
