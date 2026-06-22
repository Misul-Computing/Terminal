/** Core data shapes for the QpD eval meter. */

/** Token buckets captured for a single run, mirroring pi-ai `Usage`. */
export interface TokenUsage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	total: number;
}

/** Fixture metadata loaded from `<dir>/metadata.json`. */
export interface FixtureMetadata {
	/** Shell command run in the cloned run dir; exit 0 = pass (Tier-1 oracle). */
	testCommand: string;
	/** Grader timeout in ms. Default applied by the grader when omitted. */
	timeoutMs?: number;
	/** Free-form tags for filtering / reporting. */
	tags?: string[];
	/** Tool allowlist for the agent; falls back to runner default when omitted. */
	tools?: string[];
	/**
	 * Oracle files restored from the pristine `input/` into the run dir before
	 * grading, so an agent cannot pass by editing the test itself (anti-gaming).
	 * Relative paths under the fixture root. When omitted, the grader auto-detects
	 * `*.test.*` / `*.spec.*` files. Set to `[]` to disable restoration (e.g. when
	 * the oracle is a type-check with no editable test file).
	 */
	oracleFiles?: string[];
}

/** A loaded Tier-1 fixture. */
export interface EvalFixture {
	id: string;
	/** Absolute path to the fixture directory. */
	dir: string;
	/** Contents of `prompt.md`. */
	prompt: string;
	/** Absolute path to the `input/` subtree copied into each run dir. */
	inputDir: string;
	metadata: FixtureMetadata;
}

/** Result of driving the agent on one fixture/seed (pre-grading). */
export interface RunResult {
	fixtureId: string;
	seed: number;
	/** Authoritative dollar cost from `getSessionStats()`. */
	costUsd: number;
	tokens: TokenUsage;
	durationMs: number;
	/** Run dir left in place for the grader; cleaned up afterwards. */
	runDir: string;
	errored: boolean;
	errorMessage?: string;
}

/** A run with its grade attached. */
export interface ScoredRun extends RunResult {
	score: number;
}

/** A run is "passed" when its score clears the binary Tier-1 threshold. */
export function isPassed(run: ScoredRun): boolean {
	return run.score >= 1;
}

/** Aggregated quality-per-dollar report for a set of scored runs. */
export interface QpdReport {
	label: string;
	runs: ScoredRun[];
	/** Distinct fixtures covered. */
	tasksTotal: number;
	/** Total scored runs (fixtures x seeds). */
	runsTotal: number;
	meanScore: number;
	meanCostUsd: number;
	totalCostUsd: number;
	runsPassed: number;
	/** meanScore / meanCostUsd (0 when cost is 0). */
	qpd: number;
	/** totalCostUsd / runsPassed (Infinity when nothing passed). */
	costOfPass: number;
	/**
	 * Mean output (completion) tokens per run — the clean efficiency signal when
	 * cost is 0 (free model) and pass rate is at ceiling: a better scaffolding
	 * reaches the same correct result with fewer output tokens.
	 */
	meanOutputTokens: number;
	/** Mean total tokens per run (includes cache reads; noisier than output). */
	meanTotalTokens: number;
}

/** McNemar paired-significance result for an A/B comparison. */
export interface McnemarResult {
	/** Pairs where baseline passed and variant failed. */
	b2v: number;
	/** Pairs where variant passed and baseline failed. */
	v2b: number;
	/** Total discordant pairs (b2v + v2b). */
	discordant: number;
	pValue: number;
}

/** Matched-pairs A/B comparison report. */
export interface AbReport {
	baseline: QpdReport;
	variant: QpdReport;
	deltaQpd: number;
	deltaMeanScore: number;
	deltaMeanCostUsd: number;
	mcnemar: McnemarResult;
	/**
	 * 95% bootstrap CI over the per-fixture quality-per-dollar delta
	 * (`variant.QpD_fixture - baseline.QpD_fixture`, where
	 * `QpD_fixture = mean(score)/mean(cost)` over a fixture's trials). This is a
	 * genuine QpD interval, not a pass-rate interval.
	 */
	bootstrapQpdCi95: [number, number];
	/** True when McNemar p<0.05 and the bootstrap CI excludes 0. */
	significant: boolean;
	/**
	 * Efficiency signal: variant.meanOutputTokens - baseline.meanOutputTokens
	 * (negative = variant is leaner). The clean scaffolding signal when pass rate
	 * is at ceiling and cost is 0.
	 */
	deltaMeanOutputTokens: number;
	/**
	 * 95% bootstrap CI over the per-fixture output-token delta (variant - baseline).
	 * When the interval excludes 0 the efficiency difference is beyond run-to-run
	 * sampling noise.
	 */
	outputTokenDeltaCi95: [number, number];
}
