import type { AssistantMessage } from "@misul/ai";
import { describe, expect, test } from "vitest";
import { AssistantMessageComponent, collectCollapsibleItems } from "../src/modes/interactive/components/assistant-message.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

function makeMessage(content: Array<{ type: string; text?: string; thinking?: string }>): AssistantMessage {
	return {
		role: "assistant",
		content: content as any,
		model: "test-model",
		provider: "test",
		api: "openai-completions",
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
		stopReason: "stop",
		timestamp: Date.now(),
	} as AssistantMessage;
}

describe("AssistantMessageComponent collapsible blocks", () => {
	test("exposes thinking blocks as collapsible items", () => {
		initTheme("dark");
		const msg = makeMessage([
			{ type: "thinking", thinking: "Let me think about this..." },
			{ type: "text", text: "Here is my answer." },
		]);
		const component = new AssistantMessageComponent(msg, false);
		component.render(80);

		const items = component.getCollapsibleItems();
		expect(items.length).toBe(1);
		expect(items[0].expanded).toBe(true); // expanded during streaming
	});

	test("collapsed thinking blocks show as not expanded", () => {
		const msg = makeMessage([
			{ type: "thinking", thinking: "Deep thoughts..." },
		]);
		const component = new AssistantMessageComponent(msg, true); // hideThinkingBlock=true
		component.render(80);

		const items = component.getCollapsibleItems();
		expect(items.length).toBe(1);
		expect(items[0].expanded).toBe(false);
	});

	test("toggling a collapsible item changes expansion state", () => {
		const msg = makeMessage([
			{ type: "thinking", thinking: "Thinking here..." },
		]);
		const component = new AssistantMessageComponent(msg, true);
		component.render(80);

		const items = component.getCollapsibleItems();
		expect(items[0].expanded).toBe(false);

		items[0].setExpanded(true);
		const updatedItems = component.getCollapsibleItems();
		expect(updatedItems[0].expanded).toBe(true);
	});

	test("multiple thinking blocks each get their own collapsible item", () => {
		const msg = makeMessage([
			{ type: "thinking", thinking: "First thought..." },
			{ type: "text", text: "Intermediate text." },
			{ type: "thinking", thinking: "Second thought..." },
		]);
		const component = new AssistantMessageComponent(msg, false);
		component.render(80);

		const items = component.getCollapsibleItems();
		expect(items.length).toBe(2);
	});

	test("collectCollapsibleItems gathers items from an array of children", () => {
		const msg = makeMessage([
			{ type: "thinking", thinking: "A thought..." },
		]);
		const component = new AssistantMessageComponent(msg, false);
		component.render(80);

		const items = collectCollapsibleItems([component, { notCollapsible: true }]);
		expect(items.length).toBe(1);
	});

	test("setSelected changes the selected state on the item", () => {
		initTheme("dark");
		const msg = makeMessage([
			{ type: "thinking", thinking: "Think..." },
		]);
		const component = new AssistantMessageComponent(msg, false);
		component.render(80);

		const items = component.getCollapsibleItems();
		items[0].setSelected(true);
		// No throw = success; the header internally tracks selection
		items[0].setSelected(false);
	});
});
