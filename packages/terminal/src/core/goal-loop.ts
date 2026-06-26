/**
 * Goal mode: autonomous loop that drives the agent toward a user-defined goal.
 *
 * Loop: plan -> execute -> evaluate -> repeat.
 * - The original goal + guidelines are re-injected every iteration so they're
 *   never lost to compaction or context drift.
 * - When the agent declares GOAL: STUCK (or fails to make progress for N
 *   iterations), thinking subagents spawn with different angles to break
 *   the agent out of its current approach.
 * - The loop stops when the agent declares GOAL: ACHIEVED or the user
 *   interrupts (Esc).
 *
 * The "thinking outside the box" subagents are the key feature. Each one
 * approaches the problem from a fundamentally different angle:
 *   1. Question assumptions: what if the premise is wrong?
 *   2. Alternative approaches: what are completely different ways to solve this?
 *   3. Lateral research: what fields/problems have solved similar things?
 */

import type { AgentMessage } from "@misul/agent-core";
import type { Model } from "@misul/ai";
import { getPreset } from "./subagent/presets.ts";
import { runSubagent } from "./subagent/runner.ts";
import type { SubagentRunResult } from "./subagent/types.ts";

/** Max iterations before forcing a stuck check. */
const MAX_ITERATIONS = 50;
/** Consecutive no-progress iterations before spawning thinking subagents. */
const STUCK_THRESHOLD = 2;
/** Max thinking-subagent rounds before giving up. */
const MAX_THINKING_ROUNDS = 3;

export interface GoalLoopOptions {
	/** The user's goal description. */
	goal: string;
	/** Original guidelines/constraints (from system prompt, AGENTS.md, etc). */
	guidelines?: string;
	/** Model for the main agent (inherited from session). */
	model: Model<any>;
	/** Working directory. */
	cwd: string;
	/** Abort signal (Esc / user interrupt). */
	signal?: AbortSignal;
	/** Callback to send a prompt to the session and wait for completion. */
	prompt: (text: string) => Promise<void>;
	/** Callback to get the last assistant message text. */
	getLastResponse: () => string | undefined;
	/** Callback for status updates (shown to user). */
	onStatus?: (status: string) => void;
}

export interface GoalLoopResult {
	achieved: boolean;
	iterations: number;
	thinkingRounds: number;
	finalStatus: string;
}

const GOAL_ACHIEVED = "GOAL: ACHIEVED";
const GOAL_STUCK = "GOAL: STUCK";

export async function runGoalLoop(options: GoalLoopOptions): Promise<GoalLoopResult> {
	const { goal, guidelines, model, cwd, signal, prompt, getLastResponse, onStatus } = options;

	let iterations = 0;
	let thinkingRounds = 0;
	let stuckCount = 0;
	let lastResponse = "";

	while (iterations < MAX_ITERATIONS) {
		if (signal?.aborted) {
			return { achieved: false, iterations, thinkingRounds, finalStatus: "interrupted" };
		}

		iterations++;
		onStatus?.(`Goal iteration ${iterations}`);

		// Build the iteration prompt: re-inject goal + guidelines + progress so far.
		const iterationPrompt = buildIterationPrompt(goal, guidelines, iterations, lastResponse);
		await prompt(iterationPrompt);

		const response = getLastResponse() ?? "";
		const previousResponse = lastResponse;
		lastResponse = response;

		// Check for explicit status declarations.
		if (response.includes(GOAL_ACHIEVED)) {
			onStatus?.("Goal achieved.");
			return { achieved: true, iterations, thinkingRounds, finalStatus: "achieved" };
		}

		if (response.includes(GOAL_STUCK)) {
			stuckCount++;
		} else if (madeProgress(response, previousResponse)) {
			stuckCount = 0;
		} else {
			stuckCount++;
		}

		// If stuck, spawn thinking subagents to break out of the rut.
		if (stuckCount >= STUCK_THRESHOLD && thinkingRounds < MAX_THINKING_ROUNDS) {
			thinkingRounds++;
			stuckCount = 0;
			onStatus?.(`Stuck. Spawning thinking subagents (round ${thinkingRounds})...`);

			const insights = await spawnThinkingSubagents(goal, response, model, cwd, signal);
			if (insights) {
				// Feed insights back to the main agent as a user message.
				const insightPrompt = buildInsightPrompt(goal, insights);
				await prompt(insightPrompt);
				lastResponse = getLastResponse() ?? "";

				if (lastResponse.includes(GOAL_ACHIEVED)) {
					onStatus?.("Goal achieved after thinking round.");
					return { achieved: true, iterations, thinkingRounds, finalStatus: "achieved" };
				}
			}
		}
	}

	return { achieved: false, iterations, thinkingRounds, finalStatus: "max iterations reached" };
}

function buildIterationPrompt(goal: string, guidelines: string | undefined, iteration: number, lastProgress: string): string {
	const parts: string[] = [];

	parts.push(`## GOAL (never lose sight of this)`);
	parts.push(goal);

	if (guidelines) {
		parts.push(`\n## GUIDELINES (always follow these)`);
		parts.push(guidelines);
	}

	parts.push(`\n## ITERATION ${iteration}`);
	parts.push(`Continue working toward the goal. Do the next concrete step.`);

	if (lastProgress) {
		// Truncate to keep context manageable.
		const progress = lastProgress.slice(-4000);
		parts.push(`\n## YOUR LAST ACTIONS`);
		parts.push(progress);
	}

	parts.push(`\n## STATUS`);
	parts.push(`After your next action, declare one of:`);
	parts.push(`- ${GOAL_ACHIEVED} - the goal is fully accomplished`);
	parts.push(`- ${GOAL_STUCK} - you've tried and can't make progress with the current approach`);
	parts.push(`- (say nothing) - still making progress, will continue next iteration`);

	return parts.join("\n");
}

function buildInsightPrompt(goal: string, insights: string): string {
	return [
		`## GOAL (never lose sight of this)`,
		goal,
		`\n## OUTSIDE-THE-BOX INSIGHTS`,
		`You were stuck. Thinking subagents approached the problem from different angles. Here are their insights:`,
		"",
		insights,
		`\n## NEXT STEP`,
		`Use these insights to try a fundamentally different approach. Don't repeat what failed. After your action, declare ${GOAL_ACHIEVED}, ${GOAL_STUCK}, or nothing (still progressing).`,
	].join("\n");
}

/** Three thinking subagents, each with a different angle. */
async function spawnThinkingSubagents(
	goal: string,
	stuckOutput: string,
	model: Model<any>,
	cwd: string,
	signal?: AbortSignal,
): Promise<string | null> {
	const preset = getPreset("simple");
	if (!preset) return null;

	const context = `## GOAL\n${goal}\n\n## WHAT WAS TRIED (agent is stuck)\n${stuckOutput.slice(-4000)}`;

	const angles = [
		{
			name: "question-assumptions",
			prompt: `${context}\n\n## YOUR ANGLE: QUESTION ASSUMPTIONS\n` +
				`What assumptions is the agent making that might be wrong? What if the premise itself is flawed? ` +
				`What constraints does it think exist that actually don't? Identify 2-3 assumptions to challenge and suggest what happens if each is wrong. ` +
				`Be specific and concrete. Don't repeat what the agent already tried.`,
		},
		{
			name: "alternative-approaches",
			prompt: `${context}\n\n## YOUR ANGLE: ALTERNATIVE APPROACHES\n` +
				`What are completely different ways to solve this goal? Not variations of what was tried, but fundamentally different strategies. ` +
				`Think about: different tools, different abstractions, different decomposition, different order of operations. ` +
				`Suggest 2-3 concrete alternative approaches with enough detail to act on.`,
		},
		{
			name: "lateral-research",
			prompt: `${context}\n\n## YOUR ANGLE: LATERAL RESEARCH\n` +
				`What other fields, problems, or domains have solved similar challenges? What patterns or techniques transfer? ` +
				`Look for analogies: is this problem isomorphic to something in distributed systems, game theory, compilers, biology, etc? ` +
				`Suggest 2-3 cross-domain insights that could unblock this specific goal.`,
		},
	];

	const results = await Promise.all(
		angles.map((angle) =>
			runSubagent({
				preset,
				task: angle.prompt,
				model,
				cwd,
				signal,
				timeoutMs: 120000,
			}).catch((err): SubagentRunResult => ({
				agent: "simple",
				output: "",
				costUsd: 0,
				tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				durationMs: 0,
				phases: ["execute"],
				errored: true,
				errorMessage: err instanceof Error ? err.message : String(err),
			})),
		),
	);

	const insights = results
		.filter((r) => !r.errored && r.output.trim())
		.map((r, i) => `### ${angles[i].name}\n${r.output.trim()}`)
		.join("\n\n");

	return insights || null;
}

/** Heuristic: did the agent make progress vs the previous response? */
function madeProgress(response: string, previousResponse: string): boolean {
	const lower = response.toLowerCase();
	// No-progress signals.
	const stuckSignals = ["stuck", "unable to", "can't", "cannot", "no progress", "giving up", "dead end"];
	for (const signal of stuckSignals) {
		if (lower.includes(signal)) return false;
	}
	// If the response is nearly identical to the previous one, no progress.
	if (previousResponse && response.length > 100 && response.slice(-500) === previousResponse.slice(-500)) {
		return false;
	}
	// Progress signals: tool calls, file edits, tests run, etc.
	const progressSignals = ["edit", "write", "bash", "test", "build", "fix", "implement", "create", "update", "refactor"];
	for (const signal of progressSignals) {
		if (lower.includes(signal)) return true;
	}
	// Default: assume progress if there's substantial output.
	return response.length > 200;
}
