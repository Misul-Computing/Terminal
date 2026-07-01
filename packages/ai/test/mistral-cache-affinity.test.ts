import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	lastRequestOptions: undefined as { headers?: Record<string, string> } | undefined,
}));

vi.mock("@mistralai/mistralai", () => {
	class Mistral {
		chat = {
			stream: (_payload: unknown, requestOptions: unknown) => {
				mockState.lastRequestOptions = requestOptions as { headers?: Record<string, string> };
				const stream = {
					async *[Symbol.asyncIterator]() {
						yield {
							data: {
								id: "test",
								choices: [{ delta: { content: "response" }, finishReason: "stop" }],
								usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
							},
						};
					},
				};
				return Promise.resolve(stream);
			},
		};

		constructor(_options: unknown) {}
	}

	return { Mistral };
});

import { streamMistral } from "../src/providers/mistral.ts";
import type { Model } from "../src/types.ts";

function makeModel(): Model<"mistral-conversations"> {
	return {
		id: "mistral-large-latest",
		name: "Mistral Large",
		api: "mistral-conversations",
		provider: "mistral",
		baseUrl: "https://api.mistral.ai/v1",
		input: ["text"],
		contextWindow: 128000,
		maxTokens: 8192,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	};
}

async function captureHeaders(options?: {
	cacheRetention?: "none" | "short" | "long";
	sessionId?: string;
}): Promise<Record<string, string> | undefined> {
	await streamMistral(
		makeModel(),
		{
			messages: [{ role: "user", content: "hello", timestamp: Date.now() }],
		},
		{ apiKey: "test-key", ...options },
	).result();

	return mockState.lastRequestOptions?.headers;
}

describe("Mistral x-affinity cache header", () => {
	beforeEach(() => {
		mockState.lastRequestOptions = undefined;
	});

	it("sends x-affinity header when sessionId is provided and caching is enabled", async () => {
		const headers = await captureHeaders({ sessionId: "session-123" });
		expect(headers?.["x-affinity"]).toBe("session-123");
	});

	it("omits x-affinity header when cacheRetention is none", async () => {
		const headers = await captureHeaders({ cacheRetention: "none", sessionId: "session-123" });
		expect(headers?.["x-affinity"]).toBeUndefined();
	});

	it("omits x-affinity header when no sessionId is provided", async () => {
		const headers = await captureHeaders();
		expect(headers?.["x-affinity"]).toBeUndefined();
	});

	it("does not override explicit x-affinity header from caller", async () => {
		await streamMistral(
			makeModel(),
			{
				messages: [{ role: "user", content: "hello", timestamp: Date.now() }],
			},
			{
				apiKey: "test-key",
				sessionId: "auto-session",
				headers: { "x-affinity": "explicit-affinity" },
			},
		).result();

		expect(mockState.lastRequestOptions?.headers?.["x-affinity"]).toBe("explicit-affinity");
	});
});
