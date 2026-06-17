import { describe, expect, it } from "vitest";
import { buildQpdReport, scoreRun } from "../src/metrics.ts";
import type { RunResult, ScoredRun } from "../src/types.ts";

function run(fixtureId: string, seed: number, costUsd: number): RunResult {
	return {
		fixtureId,
		seed,
		costUsd,
		tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		durationMs: 1,
		runDir: "/tmp/x",
		errored: false,
	};
}

function scored(fixtureId: string, seed: number, costUsd: number, score: number): ScoredRun {
	return scoreRun(run(fixtureId, seed, costUsd), score);
}

describe("scoreRun", () => {
	it("attaches a score to a run", () => {
		const s = scoreRun(run("a", 1, 0.02), 1);
		expect(s.score).toBe(1);
		expect(s.fixtureId).toBe("a");
	});
});

describe("buildQpdReport", () => {
	it("computes means, qpd, and cost_of_pass", () => {
		const runs = [scored("a", 1, 0.02, 1), scored("a", 2, 0.02, 0), scored("b", 1, 0.04, 1), scored("b", 2, 0.04, 1)];
		const report = buildQpdReport("baseline", runs);
		expect(report.runsTotal).toBe(4);
		expect(report.tasksTotal).toBe(2);
		expect(report.runsPassed).toBe(3);
		expect(report.meanScore).toBeCloseTo(0.75, 10);
		expect(report.totalCostUsd).toBeCloseTo(0.12, 10);
		expect(report.meanCostUsd).toBeCloseTo(0.03, 10);
		expect(report.qpd).toBeCloseTo(0.75 / 0.03, 6);
		expect(report.costOfPass).toBeCloseTo(0.12 / 3, 6);
	});

	it("returns qpd 0 when mean cost is 0", () => {
		const report = buildQpdReport("free", [scored("a", 1, 0, 1)]);
		expect(report.qpd).toBe(0);
	});

	it("returns Infinity cost_of_pass when nothing passed", () => {
		const report = buildQpdReport("all-fail", [scored("a", 1, 0.01, 0), scored("a", 2, 0.01, 0)]);
		expect(report.runsPassed).toBe(0);
		expect(report.costOfPass).toBe(Infinity);
	});

	it("handles an empty run set without dividing by zero", () => {
		const report = buildQpdReport("empty", []);
		expect(report.runsTotal).toBe(0);
		expect(report.meanScore).toBe(0);
		expect(report.qpd).toBe(0);
		expect(report.costOfPass).toBe(Infinity);
	});
});
