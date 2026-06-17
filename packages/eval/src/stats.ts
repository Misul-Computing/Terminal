/**
 * Matched-pairs A/B statistics for the QpD meter.
 *
 * - {@link mcnemar}: paired significance on pass/fail outcomes. Exact two-sided
 *   binomial when the discordant count is small (<=25); chi-square (1 df) with
 *   continuity correction otherwise.
 * - {@link bootstrapDeltaCi}: seeded bootstrap 95% CI over a set of deltas.
 * - {@link fixtureQpdDeltas}: per-fixture quality-per-dollar deltas that the
 *   bootstrap CI is built on (so the CI genuinely reflects QpD, not pass-rate).
 * - {@link pairRuns} / {@link compareAb}: match runs by fixture+seed and build
 *   the {@link AbReport} with the significance gate (p<0.05 AND CI excludes 0).
 */

import type { AbReport, McnemarResult, QpdReport, ScoredRun } from "./types.ts";

const EXACT_BINOMIAL_MAX_DISCORDANT = 25;

export interface PairOutcome {
	baselinePass: boolean;
	variantPass: boolean;
}

/** McNemar test on paired pass/fail outcomes. */
export function mcnemar(pairs: PairOutcome[]): McnemarResult {
	let b2v = 0;
	let v2b = 0;
	for (const p of pairs) {
		if (p.baselinePass && !p.variantPass) b2v += 1;
		else if (!p.baselinePass && p.variantPass) v2b += 1;
	}
	const discordant = b2v + v2b;
	let pValue: number;
	if (discordant === 0) {
		pValue = 1;
	} else if (discordant <= EXACT_BINOMIAL_MAX_DISCORDANT) {
		pValue = exactBinomialTwoSided(Math.min(b2v, v2b), discordant);
	} else {
		// Chi-square 1 df with continuity correction; p = erfc(sqrt(chi2/2)).
		const chi2 = (Math.abs(b2v - v2b) - 1) ** 2 / discordant;
		pValue = erfc(Math.sqrt(chi2 / 2));
	}
	return { b2v, v2b, discordant, pValue: clampProb(pValue) };
}

/**
 * Two-sided exact binomial p-value for k successes in n trials at p=0.5,
 * summing all outcomes at least as extreme as k in both tails.
 */
function exactBinomialTwoSided(k: number, n: number): number {
	const observed = binomialPmf(k, n);
	// Numerical slack so the matching-extreme tail is not dropped by rounding.
	const threshold = observed * (1 + 1e-9);
	let p = 0;
	for (let i = 0; i <= n; i++) {
		if (binomialPmf(i, n) <= threshold) p += binomialPmf(i, n);
	}
	return p;
}

function binomialPmf(k: number, n: number): number {
	// p = 0.5 => C(n,k) * 0.5^n; computed in log space for stability.
	return Math.exp(logChoose(n, k) - n * Math.LN2);
}

function logChoose(n: number, k: number): number {
	return logFactorial(n) - logFactorial(k) - logFactorial(n - k);
}

function logFactorial(n: number): number {
	let sum = 0;
	for (let i = 2; i <= n; i++) sum += Math.log(i);
	return sum;
}

/** Complementary error function, Abramowitz & Stegun 7.1.26. */
function erfc(x: number): number {
	const z = Math.abs(x);
	const t = 1 / (1 + 0.3275911 * z);
	const y = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
	const erf = 1 - y * Math.exp(-z * z);
	const signedErf = x >= 0 ? erf : -erf;
	return 1 - signedErf;
}

function clampProb(p: number): number {
	if (!Number.isFinite(p)) return 1;
	return Math.min(1, Math.max(0, p));
}

/** Deterministic 32-bit PRNG. */
function mulberry32(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/**
 * Seeded bootstrap 95% CI (2.5th / 97.5th percentiles) of the mean of the
 * supplied per-pair deltas. Returns `[mean, mean]` for an empty input.
 */
export function bootstrapDeltaCi(deltas: number[], resamples = 1000, seed = 1): [number, number] {
	const n = deltas.length;
	if (n === 0) return [0, 0];
	const rand = mulberry32(seed);
	const means: number[] = [];
	for (let r = 0; r < resamples; r++) {
		let sum = 0;
		for (let i = 0; i < n; i++) sum += deltas[Math.floor(rand() * n)];
		means.push(sum / n);
	}
	means.sort((a, b) => a - b);
	return [percentile(means, 2.5), percentile(means, 97.5)];
}

function percentile(sorted: number[], p: number): number {
	if (sorted.length === 1) return sorted[0];
	const rank = (p / 100) * (sorted.length - 1);
	const lo = Math.floor(rank);
	const hi = Math.ceil(rank);
	if (lo === hi) return sorted[lo];
	return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
}

export interface RunPair {
	baseline: ScoredRun;
	variant: ScoredRun;
}

/** Match baseline and variant runs by `fixtureId::seed`. */
export function pairRuns(baseline: ScoredRun[], variant: ScoredRun[]): RunPair[] {
	const key = (r: ScoredRun) => `${r.fixtureId}::${r.seed}`;
	const variantByKey = new Map(variant.map((r) => [key(r), r]));
	const pairs: RunPair[] = [];
	for (const b of baseline) {
		const v = variantByKey.get(key(b));
		if (v) pairs.push({ baseline: b, variant: v });
	}
	return pairs;
}

/** Per-fixture quality-per-dollar: mean(score) / mean(cost), 0 when cost is 0. */
function fixtureQpd(runs: ScoredRun[]): number {
	if (runs.length === 0) return 0;
	let scoreSum = 0;
	let costSum = 0;
	for (const r of runs) {
		scoreSum += r.score;
		costSum += r.costUsd;
	}
	const meanScore = scoreSum / runs.length;
	const meanCost = costSum / runs.length;
	return meanCost > 0 ? meanScore / meanCost : 0;
}

/**
 * Per-fixture QpD deltas: for each fixture present in both arms,
 * `variant.QpD_fixture - baseline.QpD_fixture` where
 * `QpD_fixture = mean(score over its trials) / mean(cost over its trials)`.
 * This is the QpD-relevant quantity the bootstrap CI is built on.
 */
export function fixtureQpdDeltas(baseline: ScoredRun[], variant: ScoredRun[]): number[] {
	const byFixture = (runs: ScoredRun[]): Map<string, ScoredRun[]> => {
		const map = new Map<string, ScoredRun[]>();
		for (const r of runs) {
			const list = map.get(r.fixtureId);
			if (list) list.push(r);
			else map.set(r.fixtureId, [r]);
		}
		return map;
	};
	const baseByFixture = byFixture(baseline);
	const varByFixture = byFixture(variant);
	const deltas: number[] = [];
	for (const [fixtureId, baseRuns] of baseByFixture) {
		const varRuns = varByFixture.get(fixtureId);
		if (!varRuns) continue;
		deltas.push(fixtureQpd(varRuns) - fixtureQpd(baseRuns));
	}
	return deltas;
}

/** Build a matched-pairs A/B report with the significance gate applied. */
export function compareAb(baseline: QpdReport, variant: QpdReport): AbReport {
	const pairs = pairRuns(baseline.runs, variant.runs);

	const mc = mcnemar(pairs.map((p) => ({ baselinePass: p.baseline.score >= 1, variantPass: p.variant.score >= 1 })));
	// CI is built on the per-fixture QpD delta (quality-per-dollar), NOT the raw
	// score delta, so a pass-rate win that balloons cost is not flagged positive.
	const deltas = fixtureQpdDeltas(baseline.runs, variant.runs);
	const ci = bootstrapDeltaCi(deltas, 1000, 1);

	const ciExcludesZero = ci[0] > 0 || ci[1] < 0;
	const significant = mc.pValue < 0.05 && ciExcludesZero;

	return {
		baseline,
		variant,
		deltaQpd: variant.qpd - baseline.qpd,
		deltaMeanScore: variant.meanScore - baseline.meanScore,
		deltaMeanCostUsd: variant.meanCostUsd - baseline.meanCostUsd,
		mcnemar: mc,
		bootstrapQpdCi95: ci,
		significant,
	};
}
