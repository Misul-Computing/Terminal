import { describe, expect, it } from "vitest";
import { DEEP_WORK } from "../../src/core/subagent/presets.ts";
import { runDeepWork } from "../../src/core/subagent/deep-work.ts";
import type { RunSubagentInput, SubagentRunResult } from "../../src/core/subagent/types.ts";

const MODEL = { id: "faux-1", provider: "faux" } as RunSubagentInput["model"];

function ok(output: string, costUsd = 0.001): SubagentRunResult {
	return {
		agent: "deep-work",
		output,
		costUsd,
		tokens: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, total: 2 },
		durationMs: 1,
		phases: ["execute"],
		errored: false,
	};
}

/** Stub runner that returns scripted outputs in call order. */
function scriptedRunner(outputs: string[]) {
	const calls: { task: string }[] = [];
	let i = 0;
	const runner = async (input: RunSubagentInput): Promise<SubagentRunResult> => {
		calls.push({ task: input.task });
		return ok(outputs[Math.min(i++, outputs.length - 1)]);
	};
	return { runner, calls };
}

describe("runDeepWork", () => {
	it("runs spec, plan, execute, review in order and aggregates cost", async () => {
		const { runner, calls } = scriptedRunner(["spec out", "plan out", "exec out", "REVIEW: PASS looks good"]);

		const result = await runDeepWork({
			task: "build a thing",
			model: MODEL,
			cwd: process.cwd(),
			preset: DEEP_WORK,
			runner,
		});

		expect(result.errored).toBe(false);
		expect(result.phases).toEqual(["spec", "plan", "execute", "review"]);
		expect(calls.length).toBe(4);
		// Cost aggregated across 4 phases at 0.001 each.
		expect(result.costUsd).toBeCloseTo(0.004, 6);
		expect(result.tokens.total).toBe(8);
		// Final output is the execute output (the produced work).
		expect(result.output).toBe("exec out");
	});

	it("re-executes on REVIEW: FAIL, bounded by maxReviewCycles", async () => {
		// review always fails -> execute+review repeat until the cap.
		let call = 0;
		const tasks: string[] = [];
		const runner = async (input: RunSubagentInput): Promise<SubagentRunResult> => {
			tasks.push(input.task);
			call++;
			// spec, plan, then alternating execute/review where review always fails.
			const out = input.task.toLowerCase().includes("review") ? "REVIEW: FAIL try again" : `out-${call}`;
			return ok(out);
		};

		const result = await runDeepWork({
			task: "build",
			model: MODEL,
			cwd: process.cwd(),
			preset: DEEP_WORK,
			runner,
			maxReviewCycles: 2,
		});

		// Exceeding the review cap is an errored outcome.
		expect(result.errored).toBe(true);
		// execute ran maxReviewCycles times (2), each followed by a failing review.
		const executeCount = result.phases.filter((p) => p === "execute").length;
		const reviewCount = result.phases.filter((p) => p === "review").length;
		expect(executeCount).toBe(2);
		expect(reviewCount).toBe(2);
	});

	it("short-circuits to errored when a phase errors", async () => {
		let call = 0;
		const runner = async (input: RunSubagentInput): Promise<SubagentRunResult> => {
			call++;
			if (call === 2) {
				return { ...ok("plan failed"), errored: true, errorMessage: "plan phase blew up" };
			}
			return ok(`out-${call}`);
		};

		const result = await runDeepWork({
			task: "build",
			model: MODEL,
			cwd: process.cwd(),
			preset: DEEP_WORK,
			runner,
		});

		expect(result.errored).toBe(true);
		expect(result.errorMessage).toContain("plan phase blew up");
		// Stopped after the failing plan phase: spec ran, plan ran (errored), no execute/review.
		expect(result.phases).toEqual(["spec", "plan"]);
	});

	it("passes when review passes on the first cycle", async () => {
		const { runner } = scriptedRunner(["spec", "plan", "work", "review: pass"]);
		const result = await runDeepWork({
			task: "build",
			model: MODEL,
			cwd: process.cwd(),
			preset: DEEP_WORK,
			runner,
		});
		expect(result.errored).toBe(false);
		expect(result.phases.filter((p) => p === "execute").length).toBe(1);
	});

	it("#6: accepts an unmarked review verdict as PASS (no extra cycle, not errored)", async () => {
		// Review output has NEITHER `REVIEW: PASS` nor `REVIEW: FAIL`.
		const { runner, calls } = scriptedRunner(["spec", "plan", "the work", "looks fine to me"]);
		const result = await runDeepWork({
			task: "build",
			model: MODEL,
			cwd: process.cwd(),
			preset: DEEP_WORK,
			runner,
		});
		expect(result.errored).toBe(false);
		// Exactly one execute+review cycle: no wasted re-execute.
		expect(calls.length).toBe(4);
		expect(result.phases).toEqual(["spec", "plan", "execute", "review"]);
		expect(result.output).toBe("the work");
		expect(result.note).toMatch(/unmarked/i);
	});

	it("#6: an explicit REVIEW: FAIL still re-executes", async () => {
		// spec, plan, then execute, review(FAIL), execute, review(PASS).
		const { runner } = scriptedRunner(["spec", "plan", "work-1", "REVIEW: FAIL fix it", "work-2", "REVIEW: PASS ok"]);
		const result = await runDeepWork({
			task: "build",
			model: MODEL,
			cwd: process.cwd(),
			preset: DEEP_WORK,
			runner,
			maxReviewCycles: 2,
		});
		expect(result.errored).toBe(false);
		expect(result.phases.filter((p) => p === "execute").length).toBe(2);
		expect(result.output).toBe("work-2");
	});

	it("#8: maxReviewCycles:0 still runs execute at least once and returns the work product", async () => {
		const { runner, calls } = scriptedRunner(["spec", "plan", "work product", "REVIEW: PASS"]);
		const result = await runDeepWork({
			task: "build",
			model: MODEL,
			cwd: process.cwd(),
			preset: DEEP_WORK,
			runner,
			maxReviewCycles: 0,
		});
		expect(result.errored).toBe(false);
		expect(result.phases.filter((p) => p === "execute").length).toBe(1);
		expect(result.output).toBe("work product");
		expect(calls.length).toBe(4);
	});

	it("#3: clamps a NaN phase cost so the aggregate stays finite (not NaN)", async () => {
		const runner = async (input: RunSubagentInput): Promise<SubagentRunResult> => {
			const isReview = input.task.toLowerCase().includes("phase: review");
			// One phase reports a NaN cost; others a normal cost.
			const cost = isReview ? Number.NaN : 0.001;
			const out = isReview ? "REVIEW: PASS" : "out";
			return { ...ok(out, cost) };
		};
		const result = await runDeepWork({
			task: "build",
			model: MODEL,
			cwd: process.cwd(),
			preset: DEEP_WORK,
			runner,
		});
		expect(result.errored).toBe(false);
		expect(Number.isFinite(result.costUsd)).toBe(true);
		// spec + plan + execute = 3 finite phases at 0.001; review NaN clamped to 0.
		expect(result.costUsd).toBeCloseTo(0.003, 6);
	});

	it("#4: threads a tools override to every phase runner call", async () => {
		const seenTools: (string[] | undefined)[] = [];
		const runner = async (input: RunSubagentInput): Promise<SubagentRunResult> => {
			seenTools.push(input.tools);
			const out = input.task.toLowerCase().includes("phase: review") ? "REVIEW: PASS" : "out";
			return ok(out);
		};
		const result = await runDeepWork({
			task: "build",
			model: MODEL,
			cwd: process.cwd(),
			preset: DEEP_WORK,
			runner,
			tools: ["read"],
		});
		expect(result.errored).toBe(false);
		// spec, plan, execute, review all received the override.
		expect(seenTools.length).toBe(4);
		for (const tools of seenTools) {
			expect(tools).toEqual(["read"]);
		}
	});
});
