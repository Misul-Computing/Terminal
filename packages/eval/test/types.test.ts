import { describe, expect, it } from "vitest";
import type { ScoredRun } from "../src/types.ts";
import { isPassed } from "../src/types.ts";

function makeScoredRun(score: number): ScoredRun {
	return {
		fixtureId: "demo",
		seed: 1,
		costUsd: 0.01,
		tokens: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, total: 2 },
		durationMs: 100,
		runDir: "/tmp/x",
		errored: false,
		score,
	};
}

describe("isPassed", () => {
	it("treats score >= 1 as passed", () => {
		expect(isPassed(makeScoredRun(1))).toBe(true);
		expect(isPassed(makeScoredRun(1.5))).toBe(true);
	});

	it("treats score < 1 as not passed", () => {
		expect(isPassed(makeScoredRun(0))).toBe(false);
		expect(isPassed(makeScoredRun(0.99))).toBe(false);
	});
});
