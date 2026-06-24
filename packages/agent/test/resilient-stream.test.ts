import { createAssistantMessageEventStream, type AssistantMessage, type AssistantMessageEvent, type Context, type Model, type SimpleStreamOptions } from "@misul/ai";
import { describe, expect, test, vi } from "vitest";
import { createResilientStreamFn, isReasoningEffortRejected, recordReasoningEffortRejection, rejectsReasoningEffort } from "../src/resilient-stream.ts";
import type { StreamFn } from "../src/types.ts";

// Minimal model stub; only provider/id/reasoning are used by the wrapper.
function makeModel(id = "test/glm-future", reasoning = true): Model<"openai-completions"> {
	return { id, provider: id.split("/")[0], reasoning } as unknown as Model<"openai-completions">;
}

function makeContext(): Context {
	return {
		systemPrompt: "",
		messages: [{ role: "user", content: "Hi", timestamp: Date.now() }],
		tools: [],
	};
}

// Build a fake stream that emits the given events in order, then ends.
function fakeStream(events: AssistantMessageEvent[]): ReturnType<StreamFn> {
	const stream = createAssistantMessageEventStream();
	(async () => {
		for (const event of events) {
			stream.push(event);
			if (event.type === "done" || event.type === "error") {
				stream.end();
				return;
			}
		}
		stream.end();
	})();
	return Promise.resolve(stream);
}

function doneEvent(text: string): AssistantMessageEvent {
	return {
		type: "done",
		reason: "stop",
		message: {
			role: "assistant",
			content: [{ type: "text", text }],
			model: "test",
			provider: "test",
			api: "openai-completions",
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
			stopReason: "stop",
			timestamp: Date.now(),
		} as AssistantMessage,
	} as AssistantMessageEvent;
}

function errorEvent(errorMessage: string): AssistantMessageEvent {
	return {
		type: "error",
		reason: "error",
		error: { errorMessage, stopReason: "error" } as AssistantMessage,
	} as AssistantMessageEvent;
}

describe("resilient-stream", () => {
	test("isReasoningEffortRejected matches reasoning_effort 400 messages", () => {
		expect(isReasoningEffortRejected("Unrecognized request argument: reasoning_effort")).toBe(true);
		expect(isReasoningEffortRejected("reasoning_effort is not supported for this model")).toBe(true);
		expect(isReasoningEffortRejected("rate limit exceeded")).toBe(false);
		expect(isReasoningEffortRejected("invalid API key")).toBe(false);
	});

	test("forwards events verbatim when there is no reasoning_effort rejection", async () => {
		const base: StreamFn = vi.fn(() => fakeStream([doneEvent("hello")])) as unknown as StreamFn;
		const resilient = createResilientStreamFn(base);
		const model = makeModel();

		const stream = await resilient(model, makeContext(), { reasoning: "high", apiKey: "test" } as SimpleStreamOptions);
		const result = await stream.result();

		expect(result.content[0]).toMatchObject({ type: "text", text: "hello" });
		expect(base).toHaveBeenCalledOnce();
	});

	test("retries without reasoning when the first event is a reasoning_effort rejection, and caches the rejection", async () => {
		let callCount = 0;
		const base: StreamFn = vi.fn(((_model, _ctx, opts) => {
			callCount++;
			if (callCount === 1) {
				return fakeStream([errorEvent("Unrecognized request argument: reasoning_effort")]);
			}
			// Second call (retry) should have reasoning stripped.
			expect(opts?.reasoning).toBeUndefined();
			return fakeStream([doneEvent("retried-ok")]);
		}) as unknown as StreamFn);

		const resilient = createResilientStreamFn(base);
		const model = makeModel("test/new-model");

		const stream = await resilient(model, makeContext(), { reasoning: "high", apiKey: "test" } as SimpleStreamOptions);
		const result = await stream.result();

		expect(result.content[0]).toMatchObject({ type: "text", text: "retried-ok" });
		expect(base).toHaveBeenCalledTimes(2);
		// Rejection should be cached.
		expect(rejectsReasoningEffort(model)).toBe(true);
	});

	test("strips reasoning up-front when the model is already known to reject it (no wasted round-trip)", async () => {
		const base: StreamFn = vi.fn(((_model, _ctx, opts) => {
			// Should be called without reasoning on the first try.
			expect(opts?.reasoning).toBeUndefined();
			return fakeStream([doneEvent("fast-path")]);
		}) as unknown as StreamFn);

		const model = makeModel("test/cached-model");
		recordReasoningEffortRejection(model);

		const resilient = createResilientStreamFn(base);
		const stream = await resilient(model, makeContext(), { reasoning: "high", apiKey: "test" } as SimpleStreamOptions);
		const result = await stream.result();

		expect(result.content[0]).toMatchObject({ type: "text", text: "fast-path" });
		expect(base).toHaveBeenCalledOnce();
	});

	test("does not retry on non-reasoning errors (forwards the error)", async () => {
		const base: StreamFn = vi.fn(() => fakeStream([errorEvent("rate limit exceeded")])) as unknown as StreamFn;
		const resilient = createResilientStreamFn(base);
		const model = makeModel("test/rate-limited");

		const stream = await resilient(model, makeContext(), { reasoning: "high", apiKey: "test" } as SimpleStreamOptions);
		const result = await stream.result();

		expect(result.stopReason).toBe("error");
		expect(result.errorMessage).toContain("rate limit");
		expect(base).toHaveBeenCalledOnce();
		expect(rejectsReasoningEffort(model)).toBe(false);
	});
});
