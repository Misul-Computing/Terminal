import { describe, expect, test } from "vitest";
import { autoReviewVerdict, runAutoReview } from "../../src/core/subagent/autoreview.ts";
import { AUTOREVIEW } from "../../src/core/subagent/presets.ts";
import type { SubagentRunResult, SubagentRunner } from "../../src/core/subagent/types.ts";

const stubWorkResult: SubagentRunResult = {
	agent: "simple",
	output: "Did the thing.",
	costUsd: 0.01,
	tokens: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, total: 150 },
	durationMs: 1000,
	phases: ["execute"],
	errored: false,
};

function makeRunner(output: string, errored = false): SubagentRunner {
	return async () => ({
		agent: "review",
		output,
		costUsd: 0.005,
		tokens: { input: 200, output: 30, cacheRead: 0, cacheWrite: 0, total: 230 },
		durationMs: 500,
		phases: ["execute"],
		errored,
		errorMessage: errored ? "boom" : undefined,
	});
}

describe("autoReviewVerdict", () => {
	test("detects PASS", () => {
		expect(autoReviewVerdict("looks good\nAUTOREVIEW: PASS")).toBe("pass");
	});
	test("detects FAIL", () => {
		expect(autoReviewVerdict("build broken\nAUTOREVIEW: FAIL")).toBe("fail");
	});
	test("unmarked when no verdict", () => {
		expect(autoReviewVerdict("reviewed but no verdict line")).toBe("unmarked");
	});
	test("case insensitive", () => {
		expect(autoReviewVerdict("autoreview: pass")).toBe("pass");
		expect(autoReviewVerdict("AUTOREVIEW: fail")).toBe("fail");
	});
});

describe("runAutoReview", () => {
	test("appends review section to work output", async () => {
		const result = await runAutoReview({
			task: "fix the bug",
			workResult: stubWorkResult,
			model: {} as any,
			cwd: ".",
			runner: makeRunner("All good.\nAUTOREVIEW: PASS"),
		});
		expect(result.output).toContain("Did the thing.");
		expect(result.output).toContain("--- AUTOREVIEW ---");
		expect(result.output).toContain("AUTOREVIEW: PASS");
		expect(result.phases).toContain("autoreview");
	});

	test("aggregates cost and tokens", async () => {
		const result = await runAutoReview({
			task: "fix the bug",
			workResult: stubWorkResult,
			model: {} as any,
			cwd: ".",
			runner: makeRunner("AUTOREVIEW: PASS"),
		});
		expect(result.costUsd).toBeCloseTo(0.015);
		expect(result.tokens.input).toBe(300);
		expect(result.tokens.total).toBe(380);
		expect(result.durationMs).toBe(1500);
	});

	test("handles errored review agent", async () => {
		const result = await runAutoReview({
			task: "fix the bug",
			workResult: stubWorkResult,
			model: {} as any,
			cwd: ".",
			runner: makeRunner("ignored", true),
		});
		expect(result.output).toContain("AUTOREVIEW: FAIL");
		expect(result.output).toContain("review agent error: boom");
	});

	test("handles unmarked verdict", async () => {
		const result = await runAutoReview({
			task: "fix the bug",
			workResult: stubWorkResult,
			model: {} as any,
			cwd: ".",
			runner: makeRunner("reviewed but no verdict"),
		});
		expect(result.output).toContain("AUTOREVIEW: UNMARKED");
	});

	test("uses AUTOREVIEW preset", async () => {
		let capturedPreset: string | undefined;
		const runner: SubagentRunner = async (input) => {
			capturedPreset = input.preset.name;
			return { agent: "review", output: "AUTOREVIEW: PASS", costUsd: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, durationMs: 0, phases: ["execute"], errored: false };
		};
		await runAutoReview({
			task: "test",
			workResult: stubWorkResult,
			model: {} as any,
			cwd: ".",
			runner,
		});
		expect(capturedPreset).toBe(AUTOREVIEW.name);
	});
});
