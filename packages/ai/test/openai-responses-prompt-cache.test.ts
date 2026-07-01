import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { streamOpenAIResponses } from "../src/providers/openai-responses.ts";
import type { Model } from "../src/types.ts";

interface FakeOpenAIClientOptions {
	apiKey: string;
	baseURL: string;
	dangerouslyAllowBrowser: boolean;
	defaultHeaders?: Record<string, string>;
}

interface CapturedResponsesPayload {
	prompt_cache_key?: string;
	prompt_cache_retention?: "24h" | undefined;
	store?: boolean;
}

const mockState = vi.hoisted(() => ({
	lastParams: undefined as CapturedResponsesPayload | undefined,
	lastClientOptions: undefined as FakeOpenAIClientOptions | undefined,
}));

vi.mock("openai", () => {
	class FakeOpenAI {
		responses = {
			create: (params: CapturedResponsesPayload) => {
				mockState.lastParams = params;
				const stream = {
					async *[Symbol.asyncIterator]() {
						yield {
							type: "response.completed",
							response: {
								id: "resp-test",
								status: "completed",
								usage: {
									input_tokens: 1,
									output_tokens: 1,
									total_tokens: 2,
									input_tokens_details: { cached_tokens: 0 },
								},
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
		};

		constructor(options: FakeOpenAIClientOptions) {
			mockState.lastClientOptions = options;
		}
	}

	return { default: FakeOpenAI };
});

describe("openai-responses prompt caching", () => {
	beforeEach(() => {
		mockState.lastParams = undefined;
		mockState.lastClientOptions = undefined;
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	function createModel(overrides: Partial<Model<"openai-responses">> = {}): Model<"openai-responses"> {
		return {
			id: "gpt-5.4",
			name: "GPT 5.4",
			api: "openai-responses",
			provider: "openai",
			baseUrl: "https://api.openai.com/v1",
			input: ["text"],
			contextWindow: 128000,
			maxTokens: 16384,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			...overrides,
		};
	}

	async function captureRequest(
		options?: {
			cacheRetention?: "none" | "short" | "long";
			sessionId?: string;
		},
		model: Model<"openai-responses"> = createModel(),
	) {
		await streamOpenAIResponses(
			model,
			{
				systemPrompt: "sys",
				messages: [{ role: "user", content: "hi", timestamp: Date.now() }],
			},
			{ apiKey: "test-key", ...options },
		).result();

		return {
			payload: mockState.lastParams,
			headers: mockState.lastClientOptions?.defaultHeaders ?? {},
		};
	}

	it("sets prompt_cache_key from sessionId when caching is enabled", async () => {
		const { payload } = await captureRequest({ sessionId: "session-123" });
		expect(payload?.prompt_cache_key).toBe("session-123");
	});

	it("sets prompt_cache_retention to 24h when cacheRetention is long", async () => {
		const { payload } = await captureRequest({ cacheRetention: "long", sessionId: "s" });
		expect(payload?.prompt_cache_retention).toBe("24h");
	});

	it("omits prompt_cache_retention for short retention", async () => {
		const { payload } = await captureRequest({ cacheRetention: "short", sessionId: "s" });
		expect(payload?.prompt_cache_retention).toBeUndefined();
	});

	it("omits prompt_cache_key when cacheRetention is none", async () => {
		const { payload } = await captureRequest({ cacheRetention: "none", sessionId: "s" });
		expect(payload?.prompt_cache_key).toBeUndefined();
	});

	it("clamps prompt_cache_key to 64 chars", async () => {
		const { payload } = await captureRequest({ sessionId: "x".repeat(67) });
		expect(payload?.prompt_cache_key).toBe("x".repeat(64));
	});

	it("always sets store to false", async () => {
		const { payload } = await captureRequest({ sessionId: "s" });
		expect(payload?.store).toBe(false);
	});

	it("sends session_id header when sendSessionIdHeader is true", async () => {
		const { headers } = await captureRequest({ sessionId: "hdr-session" });
		expect(headers.session_id).toBe("hdr-session");
		expect(headers["x-client-request-id"]).toBe("hdr-session");
	});

	it("omits session headers when cacheRetention is none", async () => {
		const { headers } = await captureRequest({ cacheRetention: "none", sessionId: "hdr-session" });
		expect(headers.session_id).toBeUndefined();
		expect(headers["x-client-request-id"]).toBeUndefined();
	});

	it("omits session_id header when sendSessionIdHeader is false but still sends x-client-request-id", async () => {
		const model = createModel({ compat: { sendSessionIdHeader: false } });
		const { headers } = await captureRequest({ sessionId: "hdr-session" }, model);
		expect(headers.session_id).toBeUndefined();
		expect(headers["x-client-request-id"]).toBe("hdr-session");
	});

	it("omits prompt_cache_retention when supportsLongCacheRetention is false", async () => {
		const model = createModel({ compat: { supportsLongCacheRetention: false } });
		const { payload } = await captureRequest({ cacheRetention: "long", sessionId: "s" }, model);
		expect(payload?.prompt_cache_retention).toBeUndefined();
	});
});
