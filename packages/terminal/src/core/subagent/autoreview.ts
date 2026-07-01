import type { Model } from "@misul/ai";
import type { ToolName } from "../tools/index.ts";
import { AUTOREVIEW } from "./presets.ts";
import type { SubagentRunner, SubagentRunResult } from "./types.ts";

export interface AutoReviewInput {
	task: string;
	workResult: SubagentRunResult;
	model: Model<any>;
	cwd: string;
	runner: SubagentRunner;
	signal?: AbortSignal;
	tools?: ToolName[];
}

export function autoReviewVerdict(output: string): "pass" | "fail" | "unmarked" {
	const t = output.toLowerCase();
	if (t.includes("autoreview: fail")) return "fail";
	if (t.includes("autoreview: pass")) return "pass";
	return "unmarked";
}

export async function runAutoReview(input: AutoReviewInput): Promise<SubagentRunResult> {
	const { task, workResult, model, cwd, runner, signal } = input;
	const reviewResult = await runner({
		preset: AUTOREVIEW,
		task: `TASK: ${task}\n\nSUBAGENT OUTPUT:\n${workResult.output}\n\nReview the work now.`,
		model,
		cwd,
		tools: input.tools ?? AUTOREVIEW.tools,
		signal: signal ?? undefined,
	});
	const verdict = autoReviewVerdict(reviewResult.output);
	const section = reviewResult.errored
		? `AUTOREVIEW ERROR: ${reviewResult.errorMessage ?? "review agent failed"}`
		: verdict === "unmarked"
			? "AUTOREVIEW: UNMARKED"
			: reviewResult.output;
	const r = reviewResult;
	return {
		...workResult,
		output: `${workResult.output}\n\n--- AUTOREVIEW ---\n${section}\n--- END AUTOREVIEW ---`,
		costUsd: workResult.costUsd + (Number.isFinite(r.costUsd) ? r.costUsd : 0),
		tokens: {
			input: workResult.tokens.input + r.tokens.input,
			output: workResult.tokens.output + r.tokens.output,
			cacheRead: workResult.tokens.cacheRead + r.tokens.cacheRead,
			cacheWrite: workResult.tokens.cacheWrite + r.tokens.cacheWrite,
			total: workResult.tokens.total + r.tokens.total,
		},
		durationMs: workResult.durationMs + r.durationMs,
		phases: [...workResult.phases, "autoreview"],
	};
}
