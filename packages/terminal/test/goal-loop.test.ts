import { describe, expect, it, vi } from "vitest";
import {
	buildInsightPrompt,
	buildIterationPrompt,
	buildVerificationPrompt,
	detectGoalAchieved,
	detectGoalStuck,
	runGoalLoop,
	type GoalLoopOptions,
} from "../src/core/goal-loop.ts";

const noopModel = { provider: "test", id: "test", name: "test" } as any;

function makeOptions(overrides: Partial<GoalLoopOptions>): GoalLoopOptions {
	return {
		goal: "Fix the bug",
		model: noopModel,
		cwd: "/tmp",
		prompt: vi.fn(async (_text: string) => {}),
		getLastResponse: vi.fn(() => ""),
		getToolCallCount: vi.fn(() => 0),
		getLastTurnSignature: vi.fn(() => ""),
		...overrides,
	};
}

describe("buildIterationPrompt", () => {
	it("includes goal and guidelines on the first iteration", () => {
		const prompt = buildIterationPrompt("Fix the bug", "Follow AGENTS.md", 1);
		expect(prompt).toContain("## GOAL");
		expect(prompt).toContain("Fix the bug");
		expect(prompt).toContain("## GUIDELINES");
		expect(prompt).toContain("Follow AGENTS.md");
		expect(prompt).toContain("GOAL: ACHIEVED");
		expect(prompt).toContain("GOAL: STUCK");
	});

	it("omits guidelines section when none provided", () => {
		const prompt = buildIterationPrompt("Fix the bug", undefined, 1);
		expect(prompt).toContain("## GOAL");
		expect(prompt).not.toContain("## GUIDELINES");
	});

	it("sends a short continue message on subsequent iterations", () => {
		const prompt = buildIterationPrompt("Fix the bug", "guidelines", 2);
		expect(prompt).toBe("Continue working toward the goal. Do the next concrete step.");
	});
});

describe("buildVerificationPrompt", () => {
	it("asks the model to verify its work and confirm with the marker", () => {
		const prompt = buildVerificationPrompt();
		expect(prompt).toContain("verify your work");
		expect(prompt).toContain("GOAL: ACHIEVED");
	});
});

describe("buildInsightPrompt", () => {
	it("includes the insights and status protocol without re-injecting the goal", () => {
		const prompt = buildInsightPrompt("### angle\ntry something different");
		expect(prompt).toContain("OUTSIDE-THE-BOX INSIGHTS");
		expect(prompt).toContain("try something different");
		expect(prompt).toContain("GOAL: ACHIEVED");
		expect(prompt).not.toContain("## GOAL\nFix the bug");
	});
});

describe("detectGoalAchieved", () => {
	it("returns true when the marker is present", () => {
		expect(detectGoalAchieved("All done. GOAL: ACHIEVED")).toBe(true);
	});

	it("returns false when the marker is absent", () => {
		expect(detectGoalAchieved("Still working on it.")).toBe(false);
	});
});

describe("detectGoalStuck", () => {
	it("returns true when the marker is present", () => {
		expect(detectGoalStuck("I give up. GOAL: STUCK")).toBe(true);
	});

	it("returns false when the marker is absent", () => {
		expect(detectGoalStuck("Making progress.")).toBe(false);
	});
});

describe("runGoalLoop", () => {
	it("returns achieved when the model declares and verifies the goal", async () => {
		const responses = ["GOAL: ACHIEVED", "GOAL: ACHIEVED"];
		let callIndex = 0;
		const prompt = vi.fn(async () => {
			callIndex++;
		});
		const getLastResponse = vi.fn(() => responses[Math.min(callIndex, responses.length - 1)]);

		const result = await runGoalLoop(makeOptions({
			prompt,
			getLastResponse,
			getToolCallCount: () => 0,
		}));

		expect(result.achieved).toBe(true);
		expect(result.iterations).toBe(1);
		expect(result.finalStatus).toBe("achieved");
		// First prompt is the iteration, second is the verification.
		expect(prompt).toHaveBeenCalledTimes(2);
	});

	it("continues when verification fails", async () => {
		const responses = ["GOAL: ACHIEVED", "Not done yet, still working", "GOAL: ACHIEVED", "GOAL: ACHIEVED"];
		let callIndex = 0;
		const prompt = vi.fn(async () => {
			callIndex++;
		});
		const getLastResponse = vi.fn(() => responses[Math.min(callIndex, responses.length - 1)]);

		const result = await runGoalLoop(makeOptions({
			prompt,
			getLastResponse,
			getToolCallCount: () => 0,
		}));

		expect(result.achieved).toBe(true);
		expect(result.iterations).toBe(2);
	});

	it("returns interrupted when the signal is already aborted", async () => {
		const controller = new AbortController();
		controller.abort();

		const result = await runGoalLoop(makeOptions({
			signal: controller.signal,
		}));

		expect(result.achieved).toBe(false);
		expect(result.finalStatus).toBe("interrupted");
	});

	it("retries once on prompt error then exits with error status", async () => {
		const prompt = vi.fn(async () => {
			throw new Error("network failure");
		});

		const result = await runGoalLoop(makeOptions({ prompt }));

		expect(result.achieved).toBe(false);
		expect(result.finalStatus).toContain("error");
		expect(prompt).toHaveBeenCalledTimes(2);
	});

	it("tracks cost and tokens via getStats", async () => {
		const responses = ["GOAL: ACHIEVED", "GOAL: ACHIEVED"];
		let callIndex = 0;
		const prompt = vi.fn(async () => {
			callIndex++;
		});
		const getLastResponse = vi.fn(() => responses[Math.min(callIndex, responses.length - 1)]);

		const result = await runGoalLoop(makeOptions({
			prompt,
			getLastResponse,
			getStats: () => ({
				cost: 0.05,
				tokens: { input: 1000, output: 500, cacheRead: 200, cacheWrite: 100, total: 1800 },
			}),
		}));

		expect(result.costUsd).toBe(0.05);
		expect(result.tokens.total).toBe(1800);
	});
});
