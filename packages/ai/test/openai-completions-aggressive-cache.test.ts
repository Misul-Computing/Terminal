import { Type } from "typebox";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { streamOpenAICompletions } from "../src/providers/openai-completions.ts";
import type { CacheAggressiveness, Model } from "../src/types.ts";

interface CacheControl {
	type: "ephemeral";
	ttl?: string;
}

interface TextPart {
	type: "text";
	text: string;
	cache_control?: CacheControl;
}

interface ToolWithCacheControl {
	type: string;
	cache_control?: CacheControl;
}

interface CapturedParams {
	messages: Array<{
		role: string;
		content: string | TextPart[] | null;
	}>;
	tools?: ToolWithCacheControl[];
}

const mockState = vi.hoisted(() => ({
	lastParams: undefined as CapturedParams | undefined,
}));

vi.mock("openai", () => {
	class FakeOpenAI {
		chat = {
			completions: {
				create: (params: CapturedParams) => {
					mockState.lastParams = params;
					const stream = {
						async *[Symbol.asyncIterator]() {
							yield {
								id: "chatcmpl-test",
								choices: [{ delta: {}, finish_reason: "stop" }],
								usage: {
									prompt_tokens: 1,
									completion_tokens: 1,
									prompt_tokens_details: { cached_tokens: 0 },
									completion_tokens_details: { reasoning_tokens: 0 },
								},
							};
						},
					};
					const promise = Promise.resolve(stream) as Promise<typeof stream> & {
						withResponse: () => Promise<{
							data: typeof stream;
							response: { status: number; headers: Headers };
						}>;
					};
					promise.withResponse = async () => ({
						data: stream,
						response: { status: 200, headers: new Headers() },
					});
					return promise;
				},
			},
		};
	}

	return { default: FakeOpenAI };
});

function makeModel(): Model<"openai-completions"> {
	return {
		id: "anthropic/claude-sonnet-4",
		name: "Claude Sonnet 4",
		api: "openai-completions",
		provider: "openrouter",
		baseUrl: "https://openrouter.ai/api/v1",
		input: ["text"],
		contextWindow: 200000,
		maxTokens: 8192,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		compat: { cacheControlFormat: "anthropic" },
	};
}

async function capturePayload(aggressiveness?: CacheAggressiveness): Promise<CapturedParams> {
	const timestamp = Date.now();
	await streamOpenAICompletions(
		makeModel(),
		{
			systemPrompt: "System prompt",
			messages: [
				{ role: "user", content: "first message", timestamp },
				{
					role: "assistant",
					content: [{ type: "text", text: "first response" }],
					provider: "openrouter",
					api: "openai-completions",
					model: "anthropic/claude-sonnet-4",
					usage: {
						input: 0,
						output: 0,
						cacheRead: 0,
						cacheWrite: 0,
						totalTokens: 0,
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
					},
					stopReason: "stop",
					timestamp,
				},
				{ role: "user", content: "second message", timestamp },
			],
			tools: [
				{
					name: "read",
					description: "Read a file",
					parameters: Type.Object({ path: Type.String() }),
				},
			],
		},
		{
			apiKey: "test-key",
			...(aggressiveness ? { cacheAggressiveness: aggressiveness } : {}),
		},
	).result();

	if (!mockState.lastParams) throw new Error("Expected payload capture");
	return mockState.lastParams;
}

function countCacheControls(params: CapturedParams): number {
	let count = 0;
	for (const msg of params.messages) {
		if (Array.isArray(msg.content)) {
			for (const part of msg.content) {
				if (part.cache_control) count++;
			}
		}
	}
	for (const tool of params.tools ?? []) {
		if (tool.cache_control) count++;
	}
	return count;
}

describe("openai-completions aggressive cache control", () => {
	beforeEach(() => {
		mockState.lastParams = undefined;
	});

	it("standard: 3 breakpoints (system, last tool, last message)", async () => {
		const params = await capturePayload("standard");
		// system(1) + tools(1) + last user msg(1) = 3
		expect(countCacheControls(params)).toBe(3);
	});

	it("aggressive: 4 breakpoints (system, last tool, last + second-to-last message)", async () => {
		const params = await capturePayload("aggressive");
		// system(1) + tools(1) + last user msg(1) + 2nd-to-last(assistant)(1) = 4
		expect(countCacheControls(params)).toBe(4);
	});

	it("aggressive: second-to-last message has cache_control", async () => {
		const params = await capturePayload("aggressive");
		const messages = params.messages;
		// Find the assistant message (second-to-last conversation message)
		const conversationMsgs = messages.filter((m) => m.role === "user" || m.role === "assistant");
		const secondToLast = conversationMsgs[conversationMsgs.length - 2];
		expect(secondToLast).toBeDefined();
		expect(secondToLast.role).toBe("assistant");
		expect(Array.isArray(secondToLast.content)).toBe(true);
		const lastPart = (secondToLast.content as TextPart[])[(secondToLast.content as TextPart[]).length - 1];
		expect(lastPart.cache_control).toEqual({ type: "ephemeral" });
	});

	it("standard: second-to-last message has no cache_control", async () => {
		const params = await capturePayload("standard");
		const messages = params.messages;
		const conversationMsgs = messages.filter((m) => m.role === "user" || m.role === "assistant");
		const secondToLast = conversationMsgs[conversationMsgs.length - 2];
		expect(secondToLast).toBeDefined();
		const lastPart = (secondToLast.content as TextPart[])[(secondToLast.content as TextPart[]).length - 1];
		expect(lastPart.cache_control).toBeUndefined();
	});

	it("off: no cache_control markers", async () => {
		const params = await capturePayload("off");
		expect(countCacheControls(params)).toBe(0);
	});

	it("default is standard when not specified", async () => {
		const params = await capturePayload();
		expect(countCacheControls(params)).toBe(3);
	});
});
