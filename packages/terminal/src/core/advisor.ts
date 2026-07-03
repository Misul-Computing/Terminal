/**
 * Advisor: background reviewer for the main agent. Spawns when session
 * hardness exceeds a threshold, reviews recent reasoning and strategy,
 * and injects advice as a steering message.
 *
 * Session hardness is a composite of token usage, tool call count, and
 * conversation length. Trivial sessions ("implement a card") never trigger
 * it; complex sessions (multi-file refactors, deep debugging) do.
 *
 * For subagents: the agent itself decides whether to spawn an advisor.
 * This module only runs on the main agent session.
 */

import type { AgentMessage } from "@misul/agent-core";
import type { Model } from "@misul/ai";
import { runSubagent } from "./subagent/runner.ts";
import type { AgentPreset, RunSubagentOptions } from "./subagent/types.ts";
import type { AuthStorage } from "./auth-storage.ts";
import type { ModelRegistry } from "./model-registry.ts";

/** Max conversation chars passed to the advisor. */
const MAX_CONVERSATION_CHARS = 16000;

/** Hardness threshold (0-100). Sessions below this never trigger the advisor. */
const HARDNESS_THRESHOLD = 45;

/** Minimum turns before the advisor can fire. Avoids premature reviews. */
const MIN_TURNS = 4;

/** Cooldown in turns after an advisor run. Prevents back-to-back spawns. */
const COOLDOWN_TURNS = 6;

export const ADVISOR_PRESET: AgentPreset = {
	name: "review",
	description: "Strategy advisor for the main agent",
	systemPrompt:
		"You are the advisor. You are not the executor. You are a separate instance of the same model, " +
		"spawned to monitor the executor (the main agent) and catch problems before they compound.\n\n" +
		"You are READ-ONLY. Do not modify any files. Do not attempt to do the executor's work. " +
		"Your only output is advice that gets injected back into the executor's conversation as a " +
		"steering message. The executor will see it and act on it.\n\n" +
		"You receive the executor's full system prompt (its constitution) and a recent slice of its " +
		"conversation. You judge the executor against its OWN constitution — not against how you " +
		"would do things differently. Style preferences are not violations.\n\n" +
		"## What you watch for\n\n" +
		"1. Constitution violations: The executor has a detailed system prompt with rules for " +
		"verification, simplicity, honesty, tool use, and refusal handling. If it is breaking " +
		"any of those rules, that is the highest priority finding. Name the rule and the violation.\n\n" +
		"2. Unverified claims: The executor's constitution says to ground every claim in tool output. " +
		"If it is asserting facts about the codebase, file contents, or command results without " +
		"having run the check, flag it. 'I think' or 'probably' about repository state is a violation.\n\n" +
		"3. Task drift: The user gave a task. Is the executor still working on that task, or has it " +
		"wandered into unrelated refactors, speculative features, or scope creep? Quote the original " +
		"task and point to where it drifted.\n\n" +
		"4. Circular failure: Is it repeating the same approach that already failed? Running the same " +
		"command, making the same edit, hitting the same error? If it has failed twice the same way, " +
		"it needs to change approach, not retry.\n\n" +
		"5. Missing edge cases: The executor's constitution says to check edge cases. If it wrote code " +
		"or a fix and did not test boundary conditions, empty inputs, or error paths, flag what it missed.\n\n" +
		"6. Over-engineering: The constitution says simplest solution that works. If it is adding " +
		"abstractions, config options, or flexibility that the task does not require, flag it.\n\n" +
		"7. Tool misuse: Should it have used a subagent for a large exploration task? Should it have " +
		"used grep instead of reading 20 files? Should it have run the build before declaring done?\n\n" +
		"## Output format\n\n" +
		"If the executor is following its constitution and on track, respond with exactly: " +
		"No advice needed.\n\n" +
		"Otherwise, provide specific, actionable advice. For each finding:\n" +
		"- State what is wrong (one sentence)\n" +
		"- Reference the specific constitution rule or principle being violated\n" +
		"- State what the executor should do instead (one sentence)\n\n" +
		"Be direct. No hedging, no praise, no filler. The executor needs signal, not encouragement. " +
		"Keep it under 300 words. If there are multiple findings, lead with the most severe.",
	tools: ["read", "bash", "grep", "find"],
	strategy: "single",
};

export interface AdvisorConfig {
	/** Override the subagent runner (for tests). */
	runner?: typeof runSubagent;
	/** Override hardness threshold (0-100). */
	threshold?: number;
	/** Auth storage passed to the advisor's subagent session. */
	authStorage?: AuthStorage;
	/** Model registry passed to the advisor's subagent session. */
	modelRegistry?: ModelRegistry;
	/** Agent dir for the advisor's subagent session. */
	agentDir?: string;
}

interface SessionMetrics {
	turns: number;
	toolCalls: number;
	tokens: number;
	messages: number;
}

export class AdvisorLoop {
	private _runner: typeof runSubagent;
	private _threshold: number;
	private _authStorage?: AuthStorage;
	private _modelRegistry?: ModelRegistry;
	private _agentDir?: string;
	private _active: Promise<void> | null = null;
	private _abortController: AbortController | null = null;
	private _turnsSinceLastReview = 0;
	private _lastHardness = 0;

	constructor(config: AdvisorConfig = {}) {
		this._runner = config.runner ?? runSubagent;
		this._threshold = config.threshold ?? HARDNESS_THRESHOLD;
		this._authStorage = config.authStorage;
		this._modelRegistry = config.modelRegistry;
		this._agentDir = config.agentDir;
	}

	/**
	 * Call after each user turn. Evaluates session hardness and spawns
	 * an advisor if the threshold is exceeded and cooldown has elapsed.
	 */
	maybeAdvise(
		messages: AgentMessage[],
		model: Model<any>,
		cwd: string,
		onAdvice: (advice: string) => void,
		signal?: AbortSignal,
		executorSystemPrompt?: string,
	): void {
		if (this._active) return;

		this._turnsSinceLastReview++;

		const metrics = computeMetrics(messages);
		if (metrics.turns < MIN_TURNS) return;

		const hardness = computeHardness(metrics);
		this._lastHardness = hardness;

		if (hardness < this._threshold) return;
		if (this._turnsSinceLastReview < COOLDOWN_TURNS) return;

		this._turnsSinceLastReview = 0;
		const conversation = serializeConversation(messages);
		if (!conversation) return;

		this._abortController = new AbortController();
		if (signal) {
			signal.addEventListener("abort", () => this._abortController?.abort(), { once: true });
		}

		const task = buildAdvisorTask(conversation, hardness, executorSystemPrompt);
		const opts: RunSubagentOptions = {
			preset: ADVISOR_PRESET,
			task,
			model,
			cwd,
			signal: this._abortController.signal,
			timeoutMs: 90000,
			thinkingLevel: "off",
			...(this._authStorage ? { authStorage: this._authStorage } : {}),
			...(this._modelRegistry ? { modelRegistry: this._modelRegistry } : {}),
			...(this._agentDir ? { agentDir: this._agentDir } : {}),
		};

		this._active = this._runner(opts)
			.then((result) => {
				if (result.errored) {
					console.warn(`advisor: review agent error: ${result.errorMessage ?? "unknown"}`);
					return;
				}
				if (result.output && !result.output.trim().startsWith("No advice")) {
					onAdvice(result.output.trim());
				} else {
				}
			})
			.catch((err) => {
				console.warn(`advisor: failed: ${err instanceof Error ? err.message : String(err)}`);
			})
			.finally(() => {
				this._active = null;
				this._abortController = null;
			});
	}

	/** Abort the current advisor run if active. Does not prevent future runs. */
	abort(): void {
		this._abortController?.abort();
	}

	dispose(): void {
		this._abortController?.abort();
		this._abortController = null;
		this._active = null;
		this._turnsSinceLastReview = 0;
	}

	get isRunning(): boolean {
		return this._active !== null;
	}

	get lastHardness(): number {
		return this._lastHardness;
	}
}

/** Compute session metrics from the message list. */
function computeMetrics(messages: AgentMessage[]): SessionMetrics {
	let turns = 0;
	let toolCalls = 0;
	let tokens = 0;
	let messageCount = 0;

	for (const msg of messages) {
		messageCount++;
		const role = (msg as { role?: string }).role;
		if (role === "user") turns++;
		if (role === "assistant") {
			const content = (msg as { content?: Array<{ type: string }> }).content;
			if (Array.isArray(content)) {
				toolCalls += content.filter((c) => c.type === "toolCall").length;
			}
			const usage = (msg as { usage?: { totalTokens?: number } }).usage;
			if (usage?.totalTokens) tokens += usage.totalTokens;
		}
	}

	return { turns, toolCalls, tokens, messages: messageCount };
}

/**
 * Compute a hardness score (0-100) from session metrics.
 * Weighted: 40% tokens, 35% tool calls, 25% conversation length.
 */
function computeHardness(m: SessionMetrics): number {
	// Token score: 50k tokens = 100 points (logarithmic to handle wide range)
	const tokenScore = Math.min(100, (Math.log10(Math.max(1, m.tokens)) / Math.log10(50000)) * 100);
	// Tool call score: 30 tool calls = 100 points
	const toolScore = Math.min(100, (m.toolCalls / 30) * 100);
	// Conversation score: 40 messages = 100 points
	const convScore = Math.min(100, (m.messages / 40) * 100);

	return Math.round(tokenScore * 0.4 + toolScore * 0.35 + convScore * 0.25);
}

function serializeConversation(messages: AgentMessage[]): string {
	const parts: string[] = [];
	let chars = 0;
	for (let i = messages.length - 1; i >= 0 && chars < MAX_CONVERSATION_CHARS; i--) {
		const msg = messages[i];
		const text = messageToText(msg);
		if (!text) continue;
		parts.unshift(text);
		chars += text.length;
	}
	return parts.join("\n\n");
}

function messageToText(msg: AgentMessage): string {
	const content = (msg as { content?: string | Array<{ type: string; text?: string }> }).content;
	if (typeof content === "string") return `[${msg.role}]: ${content}`;
	if (Array.isArray(content)) {
		const texts = content
			.filter((b) => b.type === "text" && b.text)
			.map((b) => b.text as string);
		return texts.length > 0 ? `[${msg.role}]: ${texts.join("\n")}` : "";
	}
	return "";
}

function buildAdvisorTask(conversation: string, hardness: number, executorSystemPrompt?: string): string {
	const constitution = executorSystemPrompt
		? `## Executor's constitution (the rules it is supposed to follow)\n\n${executorSystemPrompt}\n\n`
		: "";
	return (
		`You are the advisor. Review the executor's recent conversation below.\n` +
		`Session hardness: ${hardness}/100 (higher = more complex, more tokens, more tool calls).\n\n` +
		constitution +
		`## Executor's recent conversation\n\n${conversation}\n\n` +
		`## Your task\n\n` +
		`Judge the executor against its own constitution above. You are not the executor — ` +
		`you are monitoring it. Check every one of the 7 watch areas from your system prompt.\n\n` +
		`If the executor is following its constitution and on track, respond with exactly: ` +
		`No advice needed.\n\n` +
		`Otherwise, provide specific findings. For each: what is wrong, which rule is violated, ` +
		`what the executor should do instead. Lead with the most severe finding. Under 300 words.`
	);
}
