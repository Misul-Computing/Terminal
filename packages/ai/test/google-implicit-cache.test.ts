import { beforeEach, describe, expect, it, vi } from "vitest";
import { streamGoogle } from "../src/providers/google.ts";
import type { Model } from "../src/types.ts";

interface CapturedParams {
	model: string;
	contents: Array<{
		role: string;
		parts: Array<Record<string, unknown>>;
	}>;
	config?: {
		systemInstruction?: string;
		tools?: Array<{ functionDeclarations: Array<Record<string, unknown>> }>;
		toolConfig?: unknown;
		thinkingConfig?: unknown;
	};
}

const mockState = vi.hoisted(() => ({
	lastParams: undefined as CapturedParams | undefined,
}));

vi.mock("@google/genai", () => {
	class GoogleGenAI {
		models = {
			generateContentStream: (params: CapturedParams) => {
				mockState.lastParams = params;
				const stream = {
					async *[Symbol.asyncIterator]() {
						yield {
							candidates: [
								{
									content: { parts: [{ text: "response" }] },
									finishReason: "STOP",
								},
							],
							usageMetadata: {
								promptTokenCount: 10,
								candidatesTokenCount: 5,
								totalTokenCount: 15,
								cachedContentTokenCount: 0,
							},
						};
					},
				};
				return Promise.resolve(stream);
			},
		};

		constructor(_options: unknown) {}
	}

	return { GoogleGenAI };
});

function makeModel(): Model<"google-generative-ai"> {
	return {
		id: "gemini-2.5-flash",
		name: "Gemini 2.5 Flash",
		api: "google-generative-ai",
		provider: "google",
		baseUrl: "",
		input: ["text"],
		contextWindow: 1000000,
		maxTokens: 8192,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	};
}

async function captureParams(options?: {
	systemPrompt?: string;
	tools?: Array<{ name: string; description: string; parameters: Record<string, unknown> }>;
}): Promise<CapturedParams> {
	await streamGoogle(
		makeModel(),
		{
			systemPrompt: options?.systemPrompt,
			messages: [{ role: "user", content: "hello", timestamp: Date.now() }],
			tools: options?.tools as any,
		},
		{ apiKey: "test-key" },
	).result();

	if (!mockState.lastParams) throw new Error("Expected params capture");
	return mockState.lastParams;
}

describe("Google implicit caching behavior", () => {
	beforeEach(() => {
		mockState.lastParams = undefined;
	});

	it("places system instruction in config, not in contents", async () => {
		const params = await captureParams({ systemPrompt: "You are a helpful assistant." });
		expect(params.config?.systemInstruction).toBe("You are a helpful assistant.");
		// Contents should NOT contain system instruction
		const hasSystemInContents = params.contents.some(
			(c) => c.role === "system" || (c.parts.length === 1 && c.parts[0].text === "You are a helpful assistant."),
		);
		expect(hasSystemInContents).toBe(false);
	});

	it("places tools in config, not in contents", async () => {
		const params = await captureParams({
			tools: [
				{
					name: "read",
					description: "Read a file",
					parameters: { type: "object", properties: { path: { type: "string" } } },
				},
				{
					name: "write",
					description: "Write a file",
					parameters: { type: "object", properties: { path: { type: "string" } } },
				},
			],
		});
		expect(params.config?.tools).toBeDefined();
		expect(params.config?.tools).toHaveLength(1);
		const decls = params.config?.tools?.[0]?.functionDeclarations;
		expect(decls).toHaveLength(2);
		expect(decls?.[0]?.name).toBe("read");
		expect(decls?.[1]?.name).toBe("write");
	});

	it("preserves tool order from context for cache stability", async () => {
		const params = await captureParams({
			tools: [
				{ name: "alpha", description: "A", parameters: { type: "object", properties: {} } },
				{ name: "beta", description: "B", parameters: { type: "object", properties: {} } },
				{ name: "gamma", description: "G", parameters: { type: "object", properties: {} } },
			],
		});
		const decls = params.config?.tools?.[0]?.functionDeclarations;
		expect(decls?.map((d) => d.name)).toEqual(["alpha", "beta", "gamma"]);
	});

	it("omits systemInstruction from config when no system prompt", async () => {
		const params = await captureParams();
		expect(params.config?.systemInstruction).toBeUndefined();
	});

	it("omits tools from config when no tools provided", async () => {
		const params = await captureParams();
		expect(params.config?.tools).toBeUndefined();
	});

	it("contents start with user role (stable prefix for implicit caching)", async () => {
		const params = await captureParams({ systemPrompt: "sys" });
		expect(params.contents.length).toBeGreaterThan(0);
		expect(params.contents[0].role).toBe("user");
	});
});
