import { describe, expect, it } from "vitest";
import { streamSimple } from "../src/stream.ts";
import type { CacheAggressiveness, Context, Model } from "../src/types.ts";

interface AnthropicPayload {
	messages?: Array<{
		role: string;
		content: Array<Record<string, unknown>>;
	}>;
	system?: Array<Record<string, unknown>>;
	tools?: Array<Record<string, unknown>>;
}

class PayloadCaptured extends Error {
	constructor() {
		super("payload captured");
		this.name = "PayloadCaptured";
	}
}

function makeModel(): Model<"anthropic-messages"> {
	return {
		id: "claude-test",
		name: "Claude Test",
		api: "anthropic-messages",
		provider: "anthropic",
		baseUrl: "http://127.0.0.1:9/anthropic",
		input: ["text"],
		contextWindow: 200000,
		maxTokens: 4096,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	};
}

function makeTool(name: string) {
	return {
		name,
		description: `Tool ${name}`,
		parameters: {
			type: "object" as const,
			properties: { arg: { type: "string" } },
			required: ["arg"],
		},
	};
}

function makeUsage() {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

async function capturePayload(
	context: Context,
	aggressiveness?: CacheAggressiveness,
): Promise<AnthropicPayload> {
	let captured: AnthropicPayload | undefined;
	const stream = streamSimple(makeModel(), context, {
		apiKey: "fake-key",
		...(aggressiveness ? { cacheAggressiveness: aggressiveness } : {}),
		onPayload: (payload) => {
			captured = payload as AnthropicPayload;
			throw new PayloadCaptured();
		},
	});
	try {
		await stream.result();
	} catch {
		// Expected: PayloadCaptured or connection error
	}
	if (!captured) throw new Error("Expected payload capture");
	return captured;
}

function countCacheControls(payload: AnthropicPayload): number {
	let count = 0;
	for (const block of payload.system ?? []) {
		if (block.cache_control) count++;
	}
	for (const tool of payload.tools ?? []) {
		if (tool.cache_control) count++;
	}
	for (const msg of payload.messages ?? []) {
		if (Array.isArray(msg.content)) {
			for (const block of msg.content) {
				if (block.cache_control) count++;
			}
		}
	}
	return count;
}

function getLastBlockCacheControl(msg: { content: Array<Record<string, unknown>> }): unknown {
	const lastBlock = msg.content[msg.content.length - 1];
	return lastBlock?.cache_control;
}

describe("Anthropic cache breakpoints - message type combinations", () => {
	it("aggressive: 4th breakpoint on assistant message ending with tool_use", async () => {
		const context: Context = {
			systemPrompt: "You are a helpful assistant.",
			tools: [makeTool("read"), makeTool("write")],
			messages: [
				{ role: "user", content: "read a file", timestamp: Date.now() },
				{
					role: "assistant",
					content: [
						{ type: "text", text: "I'll read the file." },
						{ type: "toolCall", id: "tool-1", name: "read", arguments: { arg: "foo" } },
					],
					provider: "anthropic",
					api: "anthropic-messages",
					model: "claude-test",
					usage: makeUsage(),
					stopReason: "toolUse",
					timestamp: Date.now(),
				},
				{
					role: "toolResult",
					toolCallId: "tool-1",
					toolName: "read",
					content: [{ type: "text", text: "file contents" }],
					isError: false,
					timestamp: Date.now(),
				},
			],
		};
		const payload = await capturePayload(context, "aggressive");
		// system(1) + tools(1, last tool) + last user msg(1) + 2nd-to-last msg(1) = 4
		expect(countCacheControls(payload)).toBe(4);

		const messages = payload.messages ?? [];
		// Last message is the tool_result user message
		const lastMsg = messages[messages.length - 1];
		expect(lastMsg.role).toBe("user");
		expect(getLastBlockCacheControl(lastMsg)).toEqual({ type: "ephemeral" });

		// Second-to-last is the assistant message ending with tool_use
		const secondToLast = messages[messages.length - 2];
		expect(secondToLast.role).toBe("assistant");
		const lastBlock = secondToLast.content[secondToLast.content.length - 1];
		expect(lastBlock.type).toBe("tool_use");
		expect(lastBlock.cache_control).toEqual({ type: "ephemeral" });
	});

	it("aggressive: 4th breakpoint on user message with tool_result (consecutive tool results)", async () => {
		const context: Context = {
			systemPrompt: "You are a helpful assistant.",
			tools: [makeTool("read"), makeTool("write")],
			messages: [
				{ role: "user", content: "read two files", timestamp: Date.now() },
				{
					role: "assistant",
					content: [
						{ type: "text", text: "Reading both files." },
						{ type: "toolCall", id: "tool-1", name: "read", arguments: { arg: "a" } },
						{ type: "toolCall", id: "tool-2", name: "read", arguments: { arg: "b" } },
					],
					provider: "anthropic",
					api: "anthropic-messages",
					model: "claude-test",
					usage: makeUsage(),
					stopReason: "toolUse",
					timestamp: Date.now(),
				},
				{
					role: "toolResult",
					toolCallId: "tool-1",
					toolName: "read",
					content: [{ type: "text", text: "contents a" }],
					isError: false,
					timestamp: Date.now(),
				},
				{
					role: "toolResult",
					toolCallId: "tool-2",
					toolName: "read",
					content: [{ type: "text", text: "contents b" }],
					isError: false,
					timestamp: Date.now(),
				},
				{
					role: "assistant",
					content: [{ type: "text", text: "Here are both files." }],
					provider: "anthropic",
					api: "anthropic-messages",
					model: "claude-test",
					usage: makeUsage(),
					stopReason: "stop",
					timestamp: Date.now(),
				},
				{ role: "user", content: "now write something", timestamp: Date.now() },
			],
		};
		const payload = await capturePayload(context, "aggressive");
		// system(1) + tools(1) + last user msg(1) + 2nd-to-last(assistant text)(1) = 4
		expect(countCacheControls(payload)).toBe(4);

		const messages = payload.messages ?? [];
		const secondToLast = messages[messages.length - 2];
		expect(secondToLast.role).toBe("assistant");
		expect(getLastBlockCacheControl(secondToLast)).toEqual({ type: "ephemeral" });
	});

	it("aggressive: 4th breakpoint on assistant message ending with text only", async () => {
		const context: Context = {
			systemPrompt: "You are a helpful assistant.",
			messages: [
				{ role: "user", content: "first message", timestamp: Date.now() },
				{
					role: "assistant",
					content: [{ type: "text", text: "first response" }],
					provider: "anthropic",
					api: "anthropic-messages",
					model: "claude-test",
					usage: makeUsage(),
					stopReason: "stop",
					timestamp: Date.now(),
				},
				{ role: "user", content: "second message", timestamp: Date.now() },
			],
		};
		const payload = await capturePayload(context, "aggressive");
		// system(1) + last user msg(1) + 2nd-to-last(assistant text)(1) = 3 (no tools)
		expect(countCacheControls(payload)).toBe(3);

		const messages = payload.messages ?? [];
		const secondToLast = messages[messages.length - 2];
		expect(secondToLast.role).toBe("assistant");
		expect(getLastBlockCacheControl(secondToLast)).toEqual({ type: "ephemeral" });
	});

	it("aggressive: thinking blocks are excluded from 4th breakpoint", async () => {
		const context: Context = {
			systemPrompt: "You are a helpful assistant.",
			messages: [
				{ role: "user", content: "think about this", timestamp: Date.now() },
				{
					role: "assistant",
					content: [
						{ type: "thinking", thinking: "Let me think...", thinkingSignature: "sig123" },
						{ type: "text", text: "Here is my answer." },
					],
					provider: "anthropic",
					api: "anthropic-messages",
					model: "claude-test",
					usage: makeUsage(),
					stopReason: "stop",
					timestamp: Date.now(),
				},
				{ role: "user", content: "follow up", timestamp: Date.now() },
			],
		};
		const payload = await capturePayload(context, "aggressive");
		const messages = payload.messages ?? [];
		const secondToLast = messages[messages.length - 2];
		expect(secondToLast.role).toBe("assistant");
		// The last block should be text (thinking comes first), so cache_control should be on text
		const lastBlock = secondToLast.content[secondToLast.content.length - 1];
		expect(lastBlock.type).toBe("text");
		expect(lastBlock.cache_control).toEqual({ type: "ephemeral" });
		// Thinking block should NOT have cache_control
		const thinkingBlock = secondToLast.content.find((b) => b.type === "thinking");
		expect(thinkingBlock?.cache_control).toBeUndefined();
	});

	it("standard: no 4th breakpoint on second-to-last message", async () => {
		const context: Context = {
			systemPrompt: "You are a helpful assistant.",
			tools: [makeTool("read")],
			messages: [
				{ role: "user", content: "first message", timestamp: Date.now() },
				{
					role: "assistant",
					content: [{ type: "text", text: "first response" }],
					provider: "anthropic",
					api: "anthropic-messages",
					model: "claude-test",
					usage: makeUsage(),
					stopReason: "stop",
					timestamp: Date.now(),
				},
				{ role: "user", content: "second message", timestamp: Date.now() },
			],
		};
		const payload = await capturePayload(context, "standard");
		// system(1) + tools(1) + last user msg(1) = 3
		expect(countCacheControls(payload)).toBe(3);

		const messages = payload.messages ?? [];
		const secondToLast = messages[messages.length - 2];
		expect(getLastBlockCacheControl(secondToLast)).toBeUndefined();
	});

	it("off: no cache_control markers anywhere", async () => {
		const context: Context = {
			systemPrompt: "You are a helpful assistant.",
			tools: [makeTool("read")],
			messages: [
				{ role: "user", content: "hello", timestamp: Date.now() },
				{
					role: "assistant",
					content: [{ type: "text", text: "hi" }],
					provider: "anthropic",
					api: "anthropic-messages",
					model: "claude-test",
					usage: makeUsage(),
					stopReason: "stop",
					timestamp: Date.now(),
				},
				{ role: "user", content: "bye", timestamp: Date.now() },
			],
		};
		const payload = await capturePayload(context, "off");
		expect(countCacheControls(payload)).toBe(0);
	});

	it("aggressive: tools breakpoint on last tool definition", async () => {
		const context: Context = {
			systemPrompt: "You are a helpful assistant.",
			tools: [makeTool("read"), makeTool("write"), makeTool("grep")],
			messages: [{ role: "user", content: "hello", timestamp: Date.now() }],
		};
		const payload = await capturePayload(context, "aggressive");
		const tools = payload.tools ?? [];
		expect(tools).toHaveLength(3);
		// Only the last tool should have cache_control
		expect(tools[0].cache_control).toBeUndefined();
		expect(tools[1].cache_control).toBeUndefined();
		expect(tools[2].cache_control).toEqual({ type: "ephemeral" });
	});

	it("aggressive: last user message with string content gets cache_control", async () => {
		const context: Context = {
			systemPrompt: "You are a helpful assistant.",
			messages: [
				{ role: "user", content: "first", timestamp: Date.now() },
				{
					role: "assistant",
					content: [{ type: "text", text: "response" }],
					provider: "anthropic",
					api: "anthropic-messages",
					model: "claude-test",
					usage: makeUsage(),
					stopReason: "stop",
					timestamp: Date.now(),
				},
				{ role: "user", content: "second", timestamp: Date.now() },
			],
		};
		const payload = await capturePayload(context, "aggressive");
		const messages = payload.messages ?? [];
		const lastMsg = messages[messages.length - 1];
		// String content should be converted to array with cache_control
		expect(Array.isArray(lastMsg.content)).toBe(true);
		const lastBlock = lastMsg.content[lastMsg.content.length - 1];
		expect(lastBlock.cache_control).toEqual({ type: "ephemeral" });
	});
});
