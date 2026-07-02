/**
 * Goal mode: autonomous loop that drives the agent toward a user-defined goal.
 *
 * Design principles (see docs/cache-aware-design.md):
 * - The goal + guidelines are sent once, in the first user message. The
 *   session's stable system prompt prefix and compaction manage context after
 *   that. Subsequent iterations send a short "continue" message so the cache
 *   prefix stays hot.
 * - Goal achievement is verified: after the model declares GOAL: ACHIEVED, a
 *   verification prompt asks it to check its work before the loop accepts.
 * - Stuck detection is based on tool-call activity and a loop-guard signature,
 *   not brittle keyword matching. No tool calls for N iterations, or repeated
 *   identical tool-call signatures, triggers thinking subagents.
 * - Cost and tokens are tracked across all iterations via session stats.
 */

import type { Model } from "@misul/ai";
import type { ThinkingLevel } from "@misul/agent-core";
import { createLoopGuard, stripVolatileIds } from "./loop-guard.ts";
import { getPreset } from "./subagent/presets.ts";
import { runSubagent } from "./subagent/runner.ts";
import type { SubagentRunResult } from "./subagent/types.ts";

const MAX_ITERATIONS = 50;
const STUCK_THRESHOLD = 5;
const MAX_THINKING_ROUNDS = 3;
const LOOP_GUARD_THRESHOLD = 3;

const GOAL_ACHIEVED = "GOAL: ACHIEVED";
const GOAL_STUCK = "GOAL: STUCK";

export interface GoalLoopStats {
	cost: number;
	tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
}

export interface GoalLoopOptions {
	goal: string;
	guidelines?: string;
	model: Model<any>;
	cwd: string;
	signal?: AbortSignal;
	thinkingLevel?: ThinkingLevel;
	tools?: string[];
	subagentPreset?: string;
	prompt: (text: string) => Promise<void>;
	getLastResponse: () => string | undefined;
	getToolCallCount: () => number;
	getLastTurnSignature: () => string;
	getStats?: () => GoalLoopStats;
	onStatus?: (status: string) => void;
}

export interface GoalLoopResult {
	achieved: boolean;
	iterations: number;
	thinkingRounds: number;
	finalStatus: string;
	costUsd: number;
	tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
}

export async function runGoalLoop(options: GoalLoopOptions): Promise<GoalLoopResult> {
	const { goal, guidelines, model, cwd, signal, prompt, getLastResponse, onStatus } = options;
	const tools = options.tools;
	const thinkingLevel = options.thinkingLevel;
	const presetName = options.subagentPreset ?? "simple";

	let iterations = 0;
	let thinkingRounds = 0;
	let stuckCount = 0;
	const loopGuard = createLoopGuard(LOOP_GUARD_THRESHOLD);

	while (iterations < MAX_ITERATIONS) {
		if (signal?.aborted) {
			return buildResult(false, iterations, thinkingRounds, "interrupted", options);
		}

		iterations++;
		onStatus?.(`Goal iteration ${iterations}`);

		const iterationPrompt = buildIterationPrompt(goal, guidelines, iterations);
		const toolCallsBefore = options.getToolCallCount();

		try {
			await prompt(iterationPrompt);
		} catch (err) {
			onStatus?.(`Iteration ${iterations} errored: ${errorText(err)}. Retrying...`);
			try {
				await prompt(iterationPrompt);
			} catch (err2) {
				return buildResult(false, iterations, thinkingRounds, `error: ${errorText(err2)}`, options);
			}
		}

		if (signal?.aborted) {
			return buildResult(false, iterations, thinkingRounds, "interrupted", options);
		}

		const response = getLastResponse() ?? "";
		const toolCallDelta = options.getToolCallCount() - toolCallsBefore;

		if (detectGoalAchieved(response)) {
			onStatus?.("Goal declared achieved. Verifying...");
			const verified = await verifyAchievement(prompt, getLastResponse, signal);
			if (verified) {
				onStatus?.("Goal verified.");
				return buildResult(true, iterations, thinkingRounds, "achieved", options);
			}
			onStatus?.("Verification failed. Continuing.");
			stuckCount = 0;
			continue;
		}

		const signature = stripVolatileIds(options.getLastTurnSignature());
		const guardTripped = loopGuard.record(signature);

		if (detectGoalStuck(response)) {
			stuckCount++;
		} else if (toolCallDelta > 0) {
			stuckCount = 0;
		} else if (guardTripped) {
			stuckCount += 2;
			onStatus?.("Loop guard tripped: repeated identical tool calls.");
		} else {
			stuckCount++;
		}

		if (stuckCount >= STUCK_THRESHOLD && thinkingRounds < MAX_THINKING_ROUNDS) {
			thinkingRounds++;
			stuckCount = 0;
			loopGuard.reset();
			onStatus?.(`Stuck. Spawning thinking subagents (round ${thinkingRounds})...`);

			const insights = await spawnThinkingSubagents(
				goal, response, model, cwd, signal, presetName, tools, thinkingLevel,
			);
			if (insights) {
				try {
					await prompt(buildInsightPrompt(insights));
				} catch (err) {
					onStatus?.(`Insight prompt failed: ${errorText(err)}`);
				}
				const afterInsight = getLastResponse() ?? "";
				if (detectGoalAchieved(afterInsight)) {
					const verified = await verifyAchievement(prompt, getLastResponse, signal);
					if (verified) {
						onStatus?.("Goal achieved after thinking round.");
						return buildResult(true, iterations, thinkingRounds, "achieved", options);
					}
				}
			}
		}
	}

	return buildResult(false, iterations, thinkingRounds, "max iterations reached", options);
}

export function buildIterationPrompt(goal: string, guidelines: string | undefined, iteration: number): string {
	if (iteration === 1) {
		const parts: string[] = ["## GOAL", goal];
		if (guidelines) {
			parts.push("\n## GUIDELINES");
			parts.push(guidelines);
		}
		parts.push("\nBegin working on this goal. Do the first concrete step.");
		parts.push(`\nWhen the goal is fully accomplished, declare ${GOAL_ACHIEVED}.`);
		parts.push(`If you cannot make progress after trying, declare ${GOAL_STUCK}.`);
		parts.push("Otherwise, keep working and say nothing about status.");
		return parts.join("\n");
	}
	return "Continue working toward the goal. Do the next concrete step.";
}

export function buildVerificationPrompt(): string {
	return [
		"You declared the goal achieved. Before confirming, verify your work:",
		"1. Review what the goal required.",
		"2. Check the actual state of the files or system you modified.",
		"3. Run any relevant tests or build commands to confirm.",
		"",
		`If everything checks out, respond with exactly: ${GOAL_ACHIEVED}`,
		"If something is incomplete or broken, explain what remains and continue working.",
	].join("\n");
}

export function buildInsightPrompt(insights: string): string {
	return [
		"## OUTSIDE-THE-BOX INSIGHTS",
		"You were stuck. Thinking subagents approached the problem from different angles. Here are their insights:",
		"",
		insights,
		"",
		"Use these insights to try a fundamentally different approach. Don't repeat what failed.",
		`If the goal is now accomplished, declare ${GOAL_ACHIEVED}. If still stuck, declare ${GOAL_STUCK}. Otherwise, keep working.`,
	].join("\n");
}

export function detectGoalAchieved(response: string): boolean {
	return response.includes(GOAL_ACHIEVED);
}

export function detectGoalStuck(response: string): boolean {
	return response.includes(GOAL_STUCK);
}

async function verifyAchievement(
	prompt: (text: string) => Promise<void>,
	getLastResponse: () => string | undefined,
	signal?: AbortSignal,
): Promise<boolean> {
	if (signal?.aborted) return false;
	try {
		await prompt(buildVerificationPrompt());
	} catch {
		return false;
	}
	return detectGoalAchieved(getLastResponse() ?? "");
}

function buildResult(
	achieved: boolean,
	iterations: number,
	thinkingRounds: number,
	finalStatus: string,
	options: GoalLoopOptions,
): GoalLoopResult {
	let costUsd = 0;
	let tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
	if (options.getStats) {
		try {
			const stats = options.getStats();
			costUsd = Number.isFinite(stats.cost) ? stats.cost : 0;
			tokens = stats.tokens;
		} catch {
			// Degrade to zero-cost rather than crashing the loop.
		}
	}
	return { achieved, iterations, thinkingRounds, finalStatus, costUsd, tokens };
}

async function spawnThinkingSubagents(
	goal: string,
	stuckOutput: string,
	model: Model<any>,
	cwd: string,
	signal: AbortSignal | undefined,
	presetName: string,
	tools: string[] | undefined,
	thinkingLevel: ThinkingLevel | undefined,
): Promise<string | null> {
	const preset = getPreset(presetName);
	if (!preset) return null;

	const context = `## GOAL\n${goal}\n\n## WHAT WAS TRIED (agent is stuck)\n${stuckOutput.slice(-4000)}`;

	const angles = [
		{
			name: "question-assumptions",
			prompt: `${context}\n\n## YOUR ANGLE: QUESTION ASSUMPTIONS\n` +
				"What assumptions is the agent making that might be wrong? What if the premise itself is flawed? " +
				"What constraints does it think exist that actually don't? Identify 2-3 assumptions to challenge and suggest what happens if each is wrong. " +
				"Be specific and concrete. Don't repeat what the agent already tried.",
		},
		{
			name: "alternative-approaches",
			prompt: `${context}\n\n## YOUR ANGLE: ALTERNATIVE APPROACHES\n` +
				"What are completely different ways to solve this goal? Not variations of what was tried, but fundamentally different strategies. " +
				"Think about: different tools, different abstractions, different decomposition, different order of operations. " +
				"Suggest 2-3 concrete alternative approaches with enough detail to act on.",
		},
		{
			name: "lateral-research",
			prompt: `${context}\n\n## YOUR ANGLE: LATERAL RESEARCH\n` +
				"What other fields, problems, or domains have solved similar challenges? What patterns or techniques transfer? " +
				"Look for analogies: is this problem isomorphic to something in distributed systems, game theory, compilers, biology, etc? " +
				"Suggest 2-3 cross-domain insights that could unblock this specific goal.",
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
				...(tools ? { tools: tools as any } : {}),
				...(thinkingLevel ? { thinkingLevel } : {}),
				timeoutMs: 120000,
			}).catch((err): SubagentRunResult => ({
				agent: preset.name,
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

function errorText(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}
