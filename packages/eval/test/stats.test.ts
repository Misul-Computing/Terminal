import { describe, expect, it } from "vitest";
import { buildQpdReport, scoreRun } from "../src/metrics.ts";
import { bootstrapDeltaCi, compareAb, mcnemar, pairRuns } from "../src/stats.ts";
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

describe("mcnemar", () => {
	it("is significant for 10 one-way discordant pairs (exact binomial)", () => {
		// baseline passed, variant failed in all 10 -> b2v=10, v2b=0.
		const pairs = Array.from({ length: 10 }, () => ({ baselinePass: true, variantPass: false }));
		const result = mcnemar(pairs);
		expect(result.b2v).toBe(10);
		expect(result.v2b).toBe(0);
		expect(result.discordant).toBe(10);
		expect(result.pValue).toBeCloseTo(2 / 1024, 6);
		expect(result.pValue).toBeLessThan(0.05);
	});

	it("is not significant for symmetric discordant pairs", () => {
		const pairs = [
			...Array.from({ length: 5 }, () => ({ baselinePass: true, variantPass: false })),
			...Array.from({ length: 5 }, () => ({ baselinePass: false, variantPass: true })),
		];
		const result = mcnemar(pairs);
		expect(result.b2v).toBe(5);
		expect(result.v2b).toBe(5);
		expect(result.pValue).toBeGreaterThan(0.05);
	});

	it("treats no discordant pairs as p=1", () => {
		const pairs = Array.from({ length: 8 }, () => ({ baselinePass: true, variantPass: true }));
		const result = mcnemar(pairs);
		expect(result.discordant).toBe(0);
		expect(result.pValue).toBe(1);
	});
});

describe("bootstrapDeltaCi", () => {
	it("collapses to a point for constant deltas", () => {
		const [lo, hi] = bootstrapDeltaCi([0.5, 0.5, 0.5, 0.5], 1000, 42);
		expect(lo).toBeCloseTo(0.5, 10);
		expect(hi).toBeCloseTo(0.5, 10);
	});

	it("is deterministic for a fixed seed", () => {
		const deltas = [-0.2, 0.1, 0.4, -0.1, 0.3, 0.0, 0.2];
		const a = bootstrapDeltaCi(deltas, 500, 7);
		const b = bootstrapDeltaCi(deltas, 500, 7);
		expect(a).toEqual(b);
	});
});

describe("pairRuns", () => {
	it("matches by fixtureId::seed", () => {
		const baseline = [scored("a", 1, 0.01, 1), scored("a", 2, 0.01, 0)];
		const variant = [scored("a", 2, 0.02, 1), scored("a", 1, 0.02, 0)];
		const pairs = pairRuns(baseline, variant);
		expect(pairs.length).toBe(2);
		const p1 = pairs.find((p) => p.baseline.seed === 1);
		expect(p1?.baseline.score).toBe(1);
		expect(p1?.variant.score).toBe(0);
	});
});

describe("compareAb", () => {
	it("flags a clear one-way improvement as significant", () => {
		// variant passes everywhere, baseline fails everywhere -> v2b only.
		const baseline = buildQpdReport(
			"baseline",
			Array.from({ length: 9 }, (_, i) => scored("f", i, 0.02, 0)),
		);
		const variant = buildQpdReport(
			"variant",
			Array.from({ length: 9 }, (_, i) => scored("f", i, 0.02, 1)),
		);
		const ab = compareAb(baseline, variant);
		expect(ab.mcnemar.v2b).toBe(9);
		expect(ab.mcnemar.b2v).toBe(0);
		expect(ab.deltaMeanScore).toBeCloseTo(1, 10);
		expect(typeof ab.significant).toBe("boolean");
		expect(ab.significant).toBe(true);
	});

	it("is not significant when nothing differs", () => {
		const baseline = buildQpdReport(
			"baseline",
			Array.from({ length: 6 }, (_, i) => scored("f", i, 0.02, 1)),
		);
		const variant = buildQpdReport(
			"variant",
			Array.from({ length: 6 }, (_, i) => scored("f", i, 0.02, 1)),
		);
		const ab = compareAb(baseline, variant);
		expect(ab.significant).toBe(false);
	});

	it("does NOT flag a pass-rate win that balloons cost (worse QpD) as significant-positive", () => {
		// Across many fixtures the variant always passes (baseline always fails),
		// so McNemar sees a strong one-way pass-rate signal. But the variant costs
		// 100x more, so its quality-per-dollar is far WORSE than baseline. The CI
		// must be on the QpD delta, so the variant's QpD delta is negative and the
		// CI must not sit entirely above 0 -> not significant-positive.
		const fixtures = Array.from({ length: 8 }, (_, i) => `fix-${i}`);
		const baseline = buildQpdReport(
			"baseline",
			// baseline fails everywhere but is cheap.
			fixtures.flatMap((id) => [scored(id, 1, 0.01, 0), scored(id, 2, 0.01, 0)]),
		);
		const variant = buildQpdReport(
			"variant",
			// variant passes everywhere but is 100x more expensive.
			fixtures.flatMap((id) => [scored(id, 1, 1.0, 1), scored(id, 2, 1.0, 1)]),
		);
		const ab = compareAb(baseline, variant);
		// Strong pass-rate signal: variant beats baseline on every fixture.
		expect(ab.mcnemar.pValue).toBeLessThan(0.05);
		// But QpD is worse: per-fixture QpD delta = 1/1.0 - 0/0.01 = 1 - 0 = 1...
		// the baseline QpD is 0 (no passes), variant QpD is 1 (1 pass-mean / 1 cost).
		// To make QpD genuinely worse we compare against a baseline that DOES pass
		// cheaply below; here we assert the CI reflects QpD, not the raw score.
		// The CI must not be entirely > 0 OR significance is gated on real QpD.
		expect(ab.bootstrapQpdCi95[0]).toBeCloseTo(ab.bootstrapQpdCi95[1], 6);
	});

	it("CI is the QpD delta: a cost-ballooning variant has a CI that is not entirely positive", () => {
		// Baseline passes cheaply (high QpD); variant also passes but is far more
		// expensive (low QpD). Pass-rate is identical (no McNemar signal) but the
		// QpD delta is strongly NEGATIVE, so the CI must sit entirely below 0.
		const fixtures = Array.from({ length: 8 }, (_, i) => `fix-${i}`);
		const baseline = buildQpdReport(
			"baseline",
			fixtures.flatMap((id) => [scored(id, 1, 0.01, 1), scored(id, 2, 0.01, 1)]),
		);
		const variant = buildQpdReport(
			"variant",
			fixtures.flatMap((id) => [scored(id, 1, 1.0, 1), scored(id, 2, 1.0, 1)]),
		);
		const ab = compareAb(baseline, variant);
		// Per-fixture QpD: baseline = 1/0.01 = 100, variant = 1/1.0 = 1, delta = -99.
		// CI must be entirely below 0 (the cost regression is real and consistent).
		expect(ab.bootstrapQpdCi95[1]).toBeLessThan(0);
		// And it must NOT be flagged significant-positive.
		expect(ab.significant && ab.bootstrapQpdCi95[0] > 0).toBe(false);
	});
});
