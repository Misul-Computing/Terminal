import { Type } from "typebox";
import { describe, expect, it } from "vitest";
import { streamOpenAICompletions } from "../src/providers/openai-completions.ts";
import type { CacheAggressiveness, Context, Model } from "../src/types.ts";

interface CacheControl {
	type: "ephemeral";
	ttl?: string;
}

interface TextPart {
	type: "text";
	text: string;
	cache_control?: CacheControl;
}

interface CapturedParams {
	messages: Array<{
		role: string;
		content: string | TextPart[] | null;
	}>;
	tools?: Array<{ type: string; cache_control?: CacheControl }>;
}

class PayloadCaptured extends Error {
	constructor() {
		super("payload captured");
		this.name = "PayloadCaptured";
	}
}

const anthropicCompatModel: Model<"openai-completions"> = {
	id: "custom-qwen",
	name: "Custom Qwen",
	api: "openai-completions",
	provider: "openrouter",
	baseUrl: "http://127.0.0.1:9/v1",
	reasoning: true,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 128000,
	maxTokens: 32000,
	compat: { cacheControlFormat: "anthropic" },
};

function makeContext(messageCount: number): Context {
	const messages: Context["messages"] = [];
	const ts = Date.now();
	const labels = ["First", "Second", "Third", "Fourth", "Fifth"];
	for (let i = 0; i < messageCount; i++) {
		if (i % 2 === 0) {
			messages.push({
				role: "user",
				content: `${labels[i] ?? `Msg${i}`} request`,
				timestamp: ts + i,
			});
		} else {
			messages.push({
				role: "assistant",
				content: [{ type: "text", text: `${labels[i] ?? `Msg${i}`} response` }],
				api: "openai-completions",
				provider: "openrouter",
				model: "custom-qwen",
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason: "stop",
				timestamp: ts + i,
			});
		}
	}
	return {
		systemPrompt: "System prompt",
		messages,
		tools: [
			{
				name: "read",
				description: "Read a file",
				parameters: Type.Object({ path: Type.String() }),
			},
		],
	};
}

async function capturePayload(
	messageCount: number,
	options?: { cacheAggressiveness?: CacheAggressiveness; cacheRetention?: "none" | "short" | "long" },
): Promise<CapturedParams> {
	let captured: CapturedParams | undefined;
	const stream = streamOpenAICompletions(anthropicCompatModel, makeContext(messageCount), {
		apiKey: "test-key",
		...(options ?? {}),
		onPayload: (payload) => {
			captured = payload as CapturedParams;
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

function countCacheMarkers(params: CapturedParams): number {
	let count = 0;
	for (const message of params.messages) {
		if (Array.isArray(message.content)) {
			for (const part of message.content) {
				if (part?.cache_control) count++;
			}
		}
	}
	if (params.tools) {
		for (const tool of params.tools) {
			if (tool.cache_control) count++;
		}
	}
	return count;
}

function getCacheMarkedConversationRoles(params: CapturedParams): string[] {
	const roles: string[] = [];
	for (const message of params.messages) {
		if (message.role === "system" || message.role === "developer") continue;
		if (Array.isArray(message.content)) {
			if (message.content.some((p) => p?.cache_control)) {
				roles.push(message.role);
			}
		}
	}
	return roles;
}

describe("openai-completions cacheAggressiveness", () => {
	it("standard: 3 breakpoints (system, last tool, last message)", async () => {
		const params = await capturePayload(3, { cacheAggressiveness: "standard" });

		expect(countCacheMarkers(params)).toBe(3);
		expect(getCacheMarkedConversationRoles(params)).toEqual(["user"]);
		expect(params.tools?.[0]?.cache_control).toEqual({ type: "ephemeral" });
	});

	it("aggressive: 4 breakpoints (system, last tool, last + second-to-last message)", async () => {
		const params = await capturePayload(3, { cacheAggressiveness: "aggressive" });

		expect(countCacheMarkers(params)).toBe(4);
		expect(getCacheMarkedConversationRoles(params)).toEqual(["assistant", "user"]);
		expect(params.tools?.[0]?.cache_control).toEqual({ type: "ephemeral" });
	});

	it("off: no cache_control markers even with cacheRetention short", async () => {
		const params = await capturePayload(3, {
			cacheAggressiveness: "off",
			cacheRetention: "short",
		});

		expect(countCacheMarkers(params)).toBe(0);
		expect(params.tools?.[0]?.cache_control).toBeUndefined();
	});

	it("aggressive with single message: only 3 breakpoints (no second-to-last)", async () => {
		const params = await capturePayload(1, { cacheAggressiveness: "aggressive" });

		expect(countCacheMarkers(params)).toBe(3);
		expect(getCacheMarkedConversationRoles(params)).toEqual(["user"]);
	});

	it("default aggressiveness is standard when unspecified", async () => {
		const params = await capturePayload(3);

		expect(countCacheMarkers(params)).toBe(3);
		expect(getCacheMarkedConversationRoles(params)).toEqual(["user"]);
	});

	it("aggressive second-to-last breakpoint lands on previous assistant turn", async () => {
		// 5 messages: user, assistant, user, assistant, user.
		// The second-to-last conversation message is the "Second response"
		// assistant turn. Caching it lets turn N+1 read the prefix up to and
		// including that assistant turn from cache.
		const params = await capturePayload(5, { cacheAggressiveness: "aggressive" });

		expect(countCacheMarkers(params)).toBe(4);
		expect(getCacheMarkedConversationRoles(params)).toEqual(["assistant", "user"]);
	});

	it("standard: second-to-last message has no cache_control", async () => {
		const params = await capturePayload(3, { cacheAggressiveness: "standard" });
		const conversationMsgs = params.messages.filter((m) => m.role !== "system" && m.role !== "developer");
		const secondToLast = conversationMsgs[conversationMsgs.length - 2];
		expect(secondToLast).toBeDefined();
		if (Array.isArray(secondToLast.content)) {
			expect(secondToLast.content[0]?.cache_control).toBeUndefined();
		}
	});
});
