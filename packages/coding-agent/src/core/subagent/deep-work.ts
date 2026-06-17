/**
 * Deep-work orchestration: a plain sequential phase loop (no DAG).
 *
 * Phases run in order: spec, plan, execute, review. The review phase emits a
 * `REVIEW: PASS` / `REVIEW: FAIL` verdict; a FAIL triggers one bounded
 * re-execute (execute then review again), capped by `maxReviewCycles`. Cost,
 * tokens, and duration aggregate across executed phases; any errored phase
 * short-circuits the run.
 */

import type { Model } from "@misul/ai";
import type { ToolName } from "../tools/index.ts";
import type { AgentPreset, SubagentRunner, SubagentRunResult } from "./types.ts";

export interface RunDeepWorkInput {
	task: string;
	model: Model<any>;
	cwd: string;
	preset: AgentPreset;
	/** Runner that executes one phase as a subagent. Injected for testing. */
	runner: SubagentRunner;
	signal?: AbortSignal;
	/** Tool subset override threaded to each phase (defaults to the preset's tools). */
	tools?: ToolName[];
	/** Max execute/review cycles before giving up (default 2). */
	maxReviewCycles?: number;
}

type Verdict = "pass" | "fail";

function reviewVerdict(output: string): Verdict {
	const text = output.toLowerCase();
	// Only an EXPLICIT `REVIEW: FAIL` re-executes. An unmarked review (the review
	// ran but emitted no verdict) is accepted, not retried, to avoid wasted cycles
	// and a false errored outcome.
	if (text.includes("review: fail")) return "fail";
	return "pass";
}

export async function runDeepWork(input: RunDeepWorkInput): Promise<SubagentRunResult> {
	const { task, model, cwd, preset, runner, tools } = input;
	// Clamp to >= 1 so execute always runs at least once (a 0 or negative cap
	// would otherwise skip execute entirely and produce no work product).
	const maxReviewCycles = Math.max(1, input.maxReviewCycles ?? 2);
	const start = Date.now();

	const phases: string[] = [];
	let costUsd = 0;
	const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
	let lastExecuteOutput = "";

	const accumulate = (result: SubagentRunResult): void => {
		// Clamp non-finite phase costs to 0 so a NaN from one phase cannot poison
		// the aggregate (which would otherwise render as `$NaN`).
		costUsd += Number.isFinite(result.costUsd) ? result.costUsd : 0;
		tokens.input += result.tokens.input;
		tokens.output += result.tokens.output;
		tokens.cacheRead += result.tokens.cacheRead;
		tokens.cacheWrite += result.tokens.cacheWrite;
		tokens.total += result.tokens.total;
	};

	const fail = (message: string): SubagentRunResult => ({
		agent: preset.name,
		output: lastExecuteOutput,
		costUsd,
		tokens,
		durationMs: Date.now() - start,
		phases,
		errored: true,
		errorMessage: message,
	});

	// spec, plan: one pass each.
	let previous = "";
	for (const phase of ["spec", "plan"] as const) {
		const result = await runner({
			preset,
			task: phaseTask(phase, task, previous),
			model,
			cwd,
			tools,
			signal: input.signal,
		});
		phases.push(phase);
		accumulate(result);
		if (result.errored) return fail(result.errorMessage ?? `${phase} phase failed`);
		previous = result.output;
	}

	// execute, review: bounded loop.
	let feedback = "";
	for (let cycle = 0; cycle < maxReviewCycles; cycle++) {
		const execResult = await runner({
			preset,
			task: phaseTask("execute", task, previous, feedback),
			model,
			cwd,
			tools,
			signal: input.signal,
		});
		phases.push("execute");
		accumulate(execResult);
		if (execResult.errored) return fail(execResult.errorMessage ?? "execute phase failed");
		lastExecuteOutput = execResult.output;

		const reviewResult = await runner({
			preset,
			task: phaseTask("review", task, execResult.output),
			model,
			cwd,
			tools,
			signal: input.signal,
		});
		phases.push("review");
		accumulate(reviewResult);
		if (reviewResult.errored) return fail(reviewResult.errorMessage ?? "review phase failed");

		if (reviewVerdict(reviewResult.output) === "pass") {
			const unmarked = !reviewResult.output.toLowerCase().includes("review: pass");
			return {
				agent: preset.name,
				output: lastExecuteOutput,
				costUsd,
				tokens,
				durationMs: Date.now() - start,
				phases,
				errored: false,
				...(unmarked ? { note: "review verdict unmarked; accepted as PASS" } : {}),
			};
		}
		feedback = reviewResult.output;
	}

	return fail(`review did not pass within ${maxReviewCycles} cycles`);
}

function phaseTask(phase: string, task: string, previous: string, feedback?: string): string {
	const parts = [`PHASE: ${phase}`, `TASK: ${task}`];
	if (previous) parts.push(`PRIOR PHASE OUTPUT:\n${previous}`);
	if (feedback) parts.push(`REVIEW FEEDBACK TO ADDRESS:\n${feedback}`);
	return parts.join("\n\n");
}
