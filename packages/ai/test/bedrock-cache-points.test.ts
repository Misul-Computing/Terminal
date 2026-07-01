import { describe, expect, it, vi } from "vitest";

const bedrockMock = vi.hoisted(() => ({
	constructorCalls: [] as Array<Record<string, unknown>>,
}));

vi.mock("@aws-sdk/client-bedrock-runtime", () => {
	class BedrockRuntimeServiceException extends Error {}

	class BedrockRuntimeClient {
		constructor(config: Record<string, unknown>) {
			bedrockMock.constructorCalls.push(config);
		}

		send(): Promise<never> {
			return Promise.reject(new Error("mock send"));
		}
	}

	class ConverseStreamCommand {
		readonly input: unknown;

		constructor(input: unknown) {
			this.input = input;
		}
	}

	return {
		BedrockRuntimeClient,
		BedrockRuntimeServiceException,
		ConverseStreamCommand,
		StopReason: {
			END_TURN: "end_turn",
			STOP_SEQUENCE: "stop_sequence",
			MAX_TOKENS: "max_tokens",
			MODEL_CONTEXT_WINDOW_EXCEEDED: "model_context_window_exceeded",
			TOOL_USE: "tool_use",
		},
		CachePointType: { DEFAULT: "default" },
		CacheTTL: { ONE_HOUR: "ONE_HOUR" },
		ConversationRole: { ASSISTANT: "assistant", USER: "user" },
		ImageFormat: { JPEG: "jpeg", PNG: "png", GIF: "gif", WEBP: "webp" },
		ToolResultStatus: { ERROR: "error", SUCCESS: "success" },
	};
});

import { getModel } from "../src/models.ts";
import { streamBedrock } from "../src/providers/amazon-bedrock.ts";
import type { CacheAggressiveness, Context, Message } from "../src/types.ts";

const baseModel = getModel("amazon-bedrock", "us.anthropic.claude-sonnet-4-5-20250929-v1:0");

async function capturePayload(
	context: Context,
	options?: { cacheRetention?: "none" | "short" | "long"; cacheAggressiveness?: CacheAggressiveness },
): Promise<unknown> {
	let capturedPayload: unknown;
	const s = streamBedrock(baseModel, context, {
		cacheRetention: options?.cacheRetention ?? "short",
		...(options?.cacheAggressiveness ? { cacheAggressiveness: options.cacheAggressiveness } : {}),
		signal: AbortSignal.abort(),
		onPayload: (payload) => {
			capturedPayload = payload;
			return payload;
		},
	});
	for await (const event of s) {
		if (event.type === "error") break;
	}
	return capturedPayload;
}

function countCachePoints(payload: any): number {
	let count = 0;
	// System cache points
	for (const block of payload?.system ?? []) {
		if (block.cachePoint) count++;
	}
	// Tool config cache points
	for (const tool of payload?.toolConfig?.tools ?? []) {
		if (tool.cachePoint) count++;
	}
	// Message cache points
	for (const msg of payload?.messages ?? []) {
		for (const block of msg.content ?? []) {
			if (block.cachePoint) count++;
		}
	}
	return count;
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

function makeTool(name: string) {
	return {
		name,
		description: `Tool ${name}`,
		parameters: { type: "object", properties: { arg: { type: "string" } } },
	};
}

describe("bedrock cache point placement", () => {
	it("standard: 3 cache points (system, tools, last message)", async () => {
		const context: Context = {
			systemPrompt: "You are a helpful assistant.",
			tools: [makeTool("read"), makeTool("write")],
			messages: [
				{ role: "user", content: "first", timestamp: Date.now() },
				{
					role: "assistant",
					content: [{ type: "text", text: "response" }],
					provider: "amazon-bedrock",
					api: "bedrock-converse-stream",
					model: baseModel.id,
					usage: makeUsage(),
					stopReason: "stop",
					timestamp: Date.now(),
				},
				{ role: "user", content: "second", timestamp: Date.now() },
			],
		};
		const payload = await capturePayload(context, { cacheRetention: "short" }) as any;
		expect(countCachePoints(payload)).toBe(3);
	});

	it("aggressive: 4 cache points (system, tools, last + second-to-last message)", async () => {
		const context: Context = {
			systemPrompt: "You are a helpful assistant.",
			tools: [makeTool("read"), makeTool("write")],
			messages: [
				{ role: "user", content: "first", timestamp: Date.now() },
				{
					role: "assistant",
					content: [{ type: "text", text: "response" }],
					provider: "amazon-bedrock",
					api: "bedrock-converse-stream",
					model: baseModel.id,
					usage: makeUsage(),
					stopReason: "stop",
					timestamp: Date.now(),
				},
				{ role: "user", content: "second", timestamp: Date.now() },
			],
		};
		const payload = await capturePayload(context, {
			cacheRetention: "short",
			cacheAggressiveness: "aggressive",
		}) as any;
		expect(countCachePoints(payload)).toBe(4);
	});

	it("off: no cache points", async () => {
		const context: Context = {
			systemPrompt: "You are a helpful assistant.",
			tools: [makeTool("read")],
			messages: [{ role: "user", content: "hello", timestamp: Date.now() }],
		};
		const payload = await capturePayload(context, { cacheAggressiveness: "off" }) as any;
		expect(countCachePoints(payload)).toBe(0);
	});

	it("none retention: no cache points", async () => {
		const context: Context = {
			systemPrompt: "You are a helpful assistant.",
			tools: [makeTool("read")],
			messages: [{ role: "user", content: "hello", timestamp: Date.now() }],
		};
		const payload = await capturePayload(context, { cacheRetention: "none" }) as any;
		expect(countCachePoints(payload)).toBe(0);
	});

	it("tools cache point is placed after the last tool", async () => {
		const context: Context = {
			systemPrompt: "sys",
			tools: [makeTool("alpha"), makeTool("beta"), makeTool("gamma")],
			messages: [{ role: "user", content: "hello", timestamp: Date.now() }],
		};
		const payload = await capturePayload(context) as any;
		const tools = payload?.toolConfig?.tools;
		expect(tools).toHaveLength(4); // 3 tools + 1 cache point
		expect(tools[0].toolSpec?.name).toBe("alpha");
		expect(tools[1].toolSpec?.name).toBe("beta");
		expect(tools[2].toolSpec?.name).toBe("gamma");
		expect(tools[3].cachePoint).toEqual({ type: "default" });
	});

	it("long retention: cache points have ONE_HOUR TTL", async () => {
		const context: Context = {
			systemPrompt: "sys",
			tools: [makeTool("read")],
			messages: [{ role: "user", content: "hello", timestamp: Date.now() }],
		};
		const payload = await capturePayload(context, { cacheRetention: "long" }) as any;
		// System cache point
		const sysBlocks = payload?.system ?? [];
		const sysCachePoint = sysBlocks.find((b: any) => b.cachePoint);
		expect(sysCachePoint?.cachePoint?.ttl).toBe("ONE_HOUR");
		// Tools cache point
		const toolsCachePoint = payload?.toolConfig?.tools?.find((t: any) => t.cachePoint);
		expect(toolsCachePoint?.cachePoint?.ttl).toBe("ONE_HOUR");
		// Last message cache point
		const lastMsg = payload?.messages?.[payload.messages.length - 1];
		const msgCachePoint = lastMsg?.content?.find((b: any) => b.cachePoint);
		expect(msgCachePoint?.cachePoint?.ttl).toBe("ONE_HOUR");
	});

	it("aggressive: second-to-last user message gets cache point", async () => {
		const messages: Message[] = [
			{ role: "user", content: "first", timestamp: Date.now() },
			{
				role: "assistant",
				content: [{ type: "text", text: "response" }],
				provider: "amazon-bedrock",
				api: "bedrock-converse-stream",
				model: baseModel.id,
				usage: makeUsage(),
				stopReason: "stop",
				timestamp: Date.now(),
			},
			{ role: "user", content: "second", timestamp: Date.now() },
			{
				role: "assistant",
				content: [{ type: "text", text: "response2" }],
				provider: "amazon-bedrock",
				api: "bedrock-converse-stream",
				model: baseModel.id,
				usage: makeUsage(),
				stopReason: "stop",
				timestamp: Date.now(),
			},
			{ role: "user", content: "third", timestamp: Date.now() },
		];
		const payload = await capturePayload(
			{ systemPrompt: "sys", messages },
			{ cacheAggressiveness: "aggressive" },
		) as any;
		const msgs = payload?.messages ?? [];
		// Last message (third user) should have cache point
		const lastMsg = msgs[msgs.length - 1];
		expect(lastMsg.role).toBe("user");
		expect(lastMsg.content.some((b: any) => b.cachePoint)).toBe(true);
		// Second-to-last user message (second user) should have cache point
		const userMsgs = msgs.filter((m: any) => m.role === "user");
		const secondToLastUser = userMsgs[userMsgs.length - 2];
		expect(secondToLastUser).toBeDefined();
		expect(secondToLastUser.content.some((b: any) => b.cachePoint)).toBe(true);
	});

	it("no tools: system + last message cache points only (standard)", async () => {
		const context: Context = {
			systemPrompt: "sys",
			messages: [{ role: "user", content: "hello", timestamp: Date.now() }],
		};
		const payload = await capturePayload(context) as any;
		// system(1) + last message(1) = 2 (no tools cache point)
		expect(countCachePoints(payload)).toBe(2);
		expect(payload?.toolConfig).toBeUndefined();
	});
});
