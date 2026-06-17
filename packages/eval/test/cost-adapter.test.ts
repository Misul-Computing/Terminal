import type { AssistantMessage } from "@earendil-works/pi-ai";
import { trace } from "@opentelemetry/api";
import { describe, expect, it } from "vitest";
import { costFieldsFromMessage, recordChat } from "../src/cost-adapter.ts";
import { AgentRunCollector } from "../src/run-collector.ts";

const tracer = trace.getTracer("eval-test");

function assistantMessage(costTotal: number | undefined): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text: "ok" }],
		api: "faux",
		provider: "faux",
		model: "faux-1",
		usage: {
			input: 10,
			output: 5,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 15,
			cost:
				costTotal === undefined
					? (undefined as never)
					: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: costTotal },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

describe("costFieldsFromMessage", () => {
	it("extracts the provider total cost", () => {
		const fields = costFieldsFromMessage(assistantMessage(0.0123));
		expect(fields.costUsd).toBe(0.0123);
		expect(fields.costUnavailableReason).toBeUndefined();
	});

	it("flags a missing cost", () => {
		const fields = costFieldsFromMessage(assistantMessage(undefined));
		expect(fields.costUsd).toBeUndefined();
		expect(fields.costUnavailableReason).toBeTruthy();
	});
});

describe("recordChat", () => {
	it("sums cost across chats via the collector snapshot", () => {
		const collector = new AgentRunCollector();
		for (const cost of [0.01, 0.02, 0.03]) {
			const span = tracer.startSpan("chat");
			recordChat(collector, span, assistantMessage(cost));
			span.end();
		}
		const snap = collector.snapshot({ stepCount: 3 });
		expect(snap.summary.cost.estimatedUsd).toBeCloseTo(0.06, 10);
	});

	it("records an unavailable reason when cost is missing", () => {
		const collector = new AgentRunCollector();
		const span = tracer.startSpan("chat");
		recordChat(collector, span, assistantMessage(undefined));
		span.end();
		const snap = collector.snapshot({ stepCount: 1 });
		expect(snap.summary.cost.estimatedUsd).toBe(0);
		expect(snap.summary.cost.unavailableReasons.length).toBeGreaterThan(0);
	});
});
