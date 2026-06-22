#!/usr/bin/env node
/**
 * CLI entrypoint for the QpD eval meter: `run` reports QpD for one config;
 * `compare` runs baseline vs variant over the SAME fixtures+seeds (matched
 * pairs) and applies the McNemar + bootstrap significance gate.
 */

import { argv } from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Model } from "@misul/ai";
import { AuthStorage, ModelRegistry } from "@misul/terminal";
import { loadFixtures } from "./fixtures.ts";
import { gradeRunDir } from "./grader.ts";
import { cleanupRunDir } from "./isolation.ts";
import { buildQpdReport, scoreRun } from "./metrics.ts";
import { runFixture } from "./runner.ts";
import { compareAb } from "./stats.ts";
import type { AbReport, EvalFixture, QpdReport, ScoredRun } from "./types.ts";

/** Fixtures live at `<package>/fixtures`, one level up from `src/` or `dist/`. */
const FIXTURES_ROOT = fileURLToPath(new URL("../fixtures", import.meta.url));

export type EvalCommand = "run" | "compare";

export interface RunEvalCliOptions {
	command: EvalCommand;
	label?: string;
	/** Variant report label for `compare` (defaults to "variant"). */
	variantLabel?: string;
	seeds: number;
	fixtureIds?: string[];
	model?: Model<string>;
	variantModel?: Model<string>;
	tools?: string[];
	variantTools?: string[];
	/** Baseline system-prompt override (scaffolding A/B). Omit for the production prompt. */
	systemPromptOverride?: () => string;
	/** Variant system-prompt override for `compare`; falls back to the baseline when omitted. */
	variantSystemPromptOverride?: () => string;
	agentDir?: string;
	/** Injected auth/model registry for offline faux runs. */
	authStorage?: AuthStorage;
	modelRegistry?: ModelRegistry;
}

export type EvalCliResult = { kind: "run"; report: QpdReport } | { kind: "compare"; report: AbReport };

interface RunConfig {
	model?: Model<string>;
	tools?: string[];
	systemPromptOverride?: () => string;
}

/** Run one config over all (fixture, seed) pairs and score each run. */
async function runConfig(
	fixtures: EvalFixture[],
	seeds: number[],
	config: RunConfig,
	shared: Pick<RunEvalCliOptions, "agentDir" | "authStorage" | "modelRegistry">,
): Promise<ScoredRun[]> {
	const scored: ScoredRun[] = [];
	for (const fixture of fixtures) {
		for (const seed of seeds) {
			// keepRunDir: the grader needs the produced edit; the CLI cleans up below.
			const run = await runFixture(fixture, {
				seed,
				model: config.model,
				tools: config.tools,
				systemPromptOverride: config.systemPromptOverride,
				agentDir: shared.agentDir,
				authStorage: shared.authStorage,
				modelRegistry: shared.modelRegistry,
				keepRunDir: true,
			});
			try {
				const grade = run.errored ? { score: 0 } : await gradeRunDir(run.runDir, fixture.metadata);
				scored.push(scoreRun(run, grade.score));
			} finally {
				// Clean every run dir, including errored runs.
				cleanupRunDir(run.runDir);
			}
		}
	}
	return scored;
}

export async function runEvalCli(options: RunEvalCliOptions): Promise<EvalCliResult> {
	const fixtures = loadFixtures(FIXTURES_ROOT, options.fixtureIds ? { ids: options.fixtureIds } : {});
	const seeds = Array.from({ length: Math.max(1, options.seeds) }, (_, i) => i + 1);
	const shared = {
		agentDir: options.agentDir,
		authStorage: options.authStorage,
		modelRegistry: options.modelRegistry,
	};

	if (options.command === "compare") {
		const baselineRuns = await runConfig(
			fixtures,
			seeds,
			{ model: options.model, tools: options.tools, systemPromptOverride: options.systemPromptOverride },
			shared,
		);
		const variantRuns = await runConfig(
			fixtures,
			seeds,
			{
				model: options.variantModel ?? options.model,
				tools: options.variantTools ?? options.tools,
				systemPromptOverride: options.variantSystemPromptOverride ?? options.systemPromptOverride,
			},
			shared,
		);
		const baseline = buildQpdReport(options.label ?? "baseline", baselineRuns);
		const variant = buildQpdReport(options.variantLabel ?? "variant", variantRuns);
		return { kind: "compare", report: compareAb(baseline, variant) };
	}

	const runs = await runConfig(
		fixtures,
		seeds,
		{ model: options.model, tools: options.tools, systemPromptOverride: options.systemPromptOverride },
		shared,
	);
	return { kind: "run", report: buildQpdReport(options.label ?? "run", runs) };
}

function usd(n: number): string {
	if (!Number.isFinite(n)) return "∞";
	return `$${n.toFixed(4)}`;
}

/** Render a single QpD report as plain text. */
export function formatReport(report: QpdReport): string {
	return [
		`== ${report.label} ==`,
		`tasks=${report.tasksTotal} runs=${report.runsTotal} passed=${report.runsPassed}`,
		`meanScore=${report.meanScore.toFixed(3)} meanCost=${usd(report.meanCostUsd)} totalCost=${usd(report.totalCostUsd)}`,
		`QpD=${report.qpd.toFixed(3)} cost_of_pass=${usd(report.costOfPass)}`,
	].join("\n");
}

/** Render an A/B comparison report as plain text. */
export function formatAbReport(report: AbReport): string {
	return [
		formatReport(report.baseline),
		"",
		formatReport(report.variant),
		"",
		"== A/B ==",
		`deltaQpD=${report.deltaQpd.toFixed(3)} deltaMeanScore=${report.deltaMeanScore.toFixed(3)} deltaMeanCost=${usd(report.deltaMeanCostUsd)}`,
		`mcnemar: b2v=${report.mcnemar.b2v} v2b=${report.mcnemar.v2b} discordant=${report.mcnemar.discordant} p=${report.mcnemar.pValue.toFixed(4)}`,
		`bootstrap95=[${report.bootstrapQpdCi95[0].toFixed(3)}, ${report.bootstrapQpdCi95[1].toFixed(3)}]`,
		`significant=${report.significant}`,
	].join("\n");
}

export interface ParsedArgv {
	command: EvalCommand;
	seeds: number;
	fixtureIds?: string[];
	label?: string;
	/** Baseline tool allowlist (csv). */
	tools?: string[];
	/** Variant tool allowlist (csv) for `compare` — the primary A/B lever. */
	variantTools?: string[];
	/** Variant model id (`provider/id` or bare id) for `compare`. */
	variantModel?: string;
	/** Variant report label for `compare`. */
	variantLabel?: string;
}

function parseCsv(value: string | undefined): string[] {
	return (value ?? "")
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
}

/**
 * Parse `misul-eval <run|compare> [--seeds N] [--fixtures a,b] [--label name]
 * [--tools a,b] [--variant-tools a,b] [--variant-model id] [--variant-label name]`.
 */
export function parseArgv(argv: string[]): ParsedArgv {
	let command: EvalCommand = "run";
	let seeds = 1;
	let fixtureIds: string[] | undefined;
	let label: string | undefined;
	let tools: string[] | undefined;
	let variantTools: string[] | undefined;
	let variantModel: string | undefined;
	let variantLabel: string | undefined;

	let i = 0;
	if (argv[0] === "run" || argv[0] === "compare") {
		command = argv[0];
		i = 1;
	}
	for (; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--seeds") seeds = Number.parseInt(argv[++i] ?? "1", 10) || 1;
		else if (arg === "--fixtures") fixtureIds = parseCsv(argv[++i]);
		else if (arg === "--label") label = argv[++i];
		else if (arg === "--tools") tools = parseCsv(argv[++i]);
		else if (arg === "--variant-tools") variantTools = parseCsv(argv[++i]);
		else if (arg === "--variant-model") variantModel = argv[++i];
		else if (arg === "--variant-label") variantLabel = argv[++i];
	}
	return { command, seeds, fixtureIds, label, tools, variantTools, variantModel, variantLabel };
}

/**
 * Resolve a `--variant-model` id against the SDK's model registry. Accepts
 * `provider/modelId` or a bare `modelId` (unambiguous match across providers).
 * Throws a clear error when the id is unknown or ambiguous.
 */
function resolveVariantModel(id: string): Model<string> {
	const registry = ModelRegistry.create(AuthStorage.create());
	const all = registry.getAll();
	const slash = id.indexOf("/");
	if (slash !== -1) {
		const provider = id.slice(0, slash);
		const modelId = id.slice(slash + 1);
		const found = registry.find(provider, modelId);
		if (!found) throw new Error(`--variant-model: unknown model "${id}" (no ${provider}/${modelId} in registry)`);
		return found as Model<string>;
	}
	const matches = all.filter((m) => m.id === id);
	if (matches.length === 0) throw new Error(`--variant-model: unknown model "${id}" (not found in registry)`);
	if (matches.length > 1) {
		const providers = matches.map((m) => `${m.provider}/${m.id}`).join(", ");
		throw new Error(`--variant-model: ambiguous model "${id}"; qualify as provider/id (candidates: ${providers})`);
	}
	return matches[0] as Model<string>;
}

/** Bin entry: drive the real configured default model (no faux), print, exit 0. */
async function main(): Promise<void> {
	const parsed = parseArgv(argv.slice(2));
	const result = await runEvalCli({
		command: parsed.command,
		seeds: parsed.seeds,
		fixtureIds: parsed.fixtureIds,
		label: parsed.label,
		variantLabel: parsed.variantLabel,
		tools: parsed.tools,
		variantTools: parsed.variantTools,
		...(parsed.variantModel ? { variantModel: resolveVariantModel(parsed.variantModel) } : {}),
	});
	if (result.kind === "compare") {
		console.log(formatAbReport(result.report));
	} else {
		console.log(formatReport(result.report));
	}
}

const invokedDirectly = argv[1] !== undefined && import.meta.url === pathToFileURL(argv[1]).href;
if (invokedDirectly) {
	main().catch((err) => {
		console.error(err instanceof Error ? err.message : String(err));
		process.exit(1);
	});
}
