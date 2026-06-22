/** QpD aggregation: turn scored runs into a {@link QpdReport}. */

import { isPassed, type QpdReport, type RunResult, type ScoredRun } from "./types.ts";

/** Attach a grade to a run. */
export function scoreRun(run: RunResult, score: number): ScoredRun {
	return { ...run, score };
}

/**
 * Build the quality-per-dollar report over a set of scored runs.
 *
 * - `qpd = meanScore / meanCostUsd`, defined as 0 when mean cost is 0 (free runs
 *   carry no QpD signal).
 * - `costOfPass = totalCostUsd / runsPassed`, Infinity when nothing passed.
 */
export function buildQpdReport(label: string, runs: ScoredRun[]): QpdReport {
	const runsTotal = runs.length;
	const tasksTotal = new Set(runs.map((r) => r.fixtureId)).size;

	let scoreSum = 0;
	let costSum = 0;
	let outputTokenSum = 0;
	let totalTokenSum = 0;
	let runsPassed = 0;
	for (const run of runs) {
		scoreSum += run.score;
		costSum += run.costUsd;
		outputTokenSum += run.tokens.output;
		totalTokenSum += run.tokens.total;
		if (isPassed(run)) runsPassed += 1;
	}

	const meanScore = runsTotal > 0 ? scoreSum / runsTotal : 0;
	const meanCostUsd = runsTotal > 0 ? costSum / runsTotal : 0;
	const qpd = meanCostUsd > 0 ? meanScore / meanCostUsd : 0;
	const costOfPass = runsPassed > 0 ? costSum / runsPassed : Infinity;

	return {
		label,
		runs,
		tasksTotal,
		runsTotal,
		meanScore,
		meanCostUsd,
		totalCostUsd: costSum,
		runsPassed,
		qpd,
		costOfPass,
		meanOutputTokens: runsTotal > 0 ? outputTokenSum / runsTotal : 0,
		meanTotalTokens: runsTotal > 0 ? totalTokenSum / runsTotal : 0,
	};
}
