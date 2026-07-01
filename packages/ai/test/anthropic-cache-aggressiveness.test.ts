import { describe, expect, it } from "vitest";
import { streamSimple } from "../src/stream.ts";
import type { CacheAggressiveness, Context, Model } from "../src/types.ts";

interface AnthropicPayload {
	messages?: Array<{
		role: string;
		content: Array<Record<string, unknown>>;
	}>;
	system?: Array<Record<string, unknown>>;
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

function makeContext(): Context {
	return {
		systemPrompt: "You are a helpful assistant.",
		messages: [
			{ role: "user", content: "first message", timestamp: Date.now() },
			{
				role: "assistant",
				content: [{ type: "text", text: "first response" }],
				provider: "anthropic",
				api: "anthropic-messages",
				model: "claude-test",
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
			},
			{ role: "user", content: "second message", timestamp: Date.now() },
		],
	};
}

async function capturePayload(aggressiveness?: CacheAggressiveness): Promise<AnthropicPayload> {
	let captured: AnthropicPayload | undefined;
	const stream = streamSimple(makeModel(), makeContext(), {
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
	for (const msg of payload.messages ?? []) {
		if (Array.isArray(msg.content)) {
			for (const block of msg.content) {
				if (block.cache_control) count++;
			}
		}
	}
	return count;
}

describe("Anthropic cache aggressiveness", () => {
	it("off: no cache_control markers", async () => {
		const payload = await capturePayload("off");
		expect(countCacheControls(payload)).toBe(0);
	});

	it("standard: 3 breakpoints (system, last message)", async () => {
		const payload = await capturePayload("standard");
		// No tools in context, so: 1 system + 1 last user message = 2.
		// (Tool breakpoint is absent because there are no tools.)
		expect(countCacheControls(payload)).toBe(2);
	});

	it("aggressive: 4 breakpoints (system, last + second-to-last message)", async () => {
		const payload = await capturePayload("aggressive");
		// No tools, so: 1 system + 1 last user + 1 second-to-last (assistant) = 3.
		expect(countCacheControls(payload)).toBe(3);
	});

	it("aggressive: second-to-last message has cache_control", async () => {
		const payload = await capturePayload("aggressive");
		const messages = payload.messages ?? [];
		const secondToLast = messages[messages.length - 2];
		expect(secondToLast).toBeDefined();
		const lastBlock = secondToLast.content[secondToLast.content.length - 1];
		expect(lastBlock.cache_control).toEqual({ type: "ephemeral" });
	});

	it("standard: second-to-last message has no cache_control", async () => {
		const payload = await capturePayload("standard");
		const messages = payload.messages ?? [];
		const secondToLast = messages[messages.length - 2];
		expect(secondToLast).toBeDefined();
		const lastBlock = secondToLast.content[secondToLast.content.length - 1];
		expect(lastBlock.cache_control).toBeUndefined();
	});

	it("default is standard when not specified", async () => {
		const payload = await capturePayload();
		const messages = payload.messages ?? [];
		const secondToLast = messages[messages.length - 2];
		const lastBlock = secondToLast.content[secondToLast.content.length - 1];
		expect(lastBlock.cache_control).toBeUndefined();
	});
});
