import { describe, expect, it } from "vitest";
import { aggregateSessionJsonl } from "../src/session-aggregator.ts";

function assistantLine(cost: number, input: number, output: number): string {
	return JSON.stringify({
		type: "message",
		message: {
			role: "assistant",
			usage: {
				input,
				output,
				cacheRead: 0,
				cacheWrite: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: cost },
			},
		},
	});
}

describe("aggregateSessionJsonl", () => {
	it("sums cost and tokens over assistant messages", () => {
		const jsonl = [
			JSON.stringify({ type: "session_start" }),
			assistantLine(0.01, 100, 20),
			JSON.stringify({ type: "message", message: { role: "user", content: "hi" } }),
			assistantLine(0.02, 200, 40),
			"",
			"   ",
		].join("\n");

		const agg = aggregateSessionJsonl(jsonl);
		expect(agg.costUsd).toBeCloseTo(0.03, 10);
		expect(agg.tokens.input).toBe(300);
		expect(agg.tokens.output).toBe(60);
		expect(agg.tokens.total).toBe(360);
		expect(agg.assistantMessages).toBe(2);
	});

	it("tolerates blank and partial lines", () => {
		const jsonl = [assistantLine(0.05, 10, 5), "{ not valid json", ""].join("\n");
		const agg = aggregateSessionJsonl(jsonl);
		expect(agg.costUsd).toBeCloseTo(0.05, 10);
		expect(agg.assistantMessages).toBe(1);
	});

	it("returns zeros for empty input", () => {
		const agg = aggregateSessionJsonl("");
		expect(agg.costUsd).toBe(0);
		expect(agg.tokens.total).toBe(0);
		expect(agg.assistantMessages).toBe(0);
	});
});
