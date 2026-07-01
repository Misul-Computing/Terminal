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

/** Max conversation chars passed to the advisor. */
const MAX_CONVERSATION_CHARS = 16000;

/** Hardness threshold (0-100). Sessions below this never trigger the advisor. */
const HARDNESS_THRESHOLD = 45;

/** Minimum turns before the advisor can fire. Avoids premature reviews. */
const MIN_TURNS = 4;

/** Cooldown in turns after an advisor run. Prevents back-to-back spawns. */
const COOLDOWN_TURNS = 6;

const ADVISOR_PRESET: AgentPreset = {
	name: "review",
	description: "Strategy advisor for the main agent",
	systemPrompt:
		"You are a strategy advisor reviewing another agent's work. You are READ-ONLY. " +
		"Do not modify any files. Review the conversation and provide concise, actionable advice. " +
		"Focus on: missed simpler approaches, over-engineering, unverified assumptions, " +
		"potential bugs, and whether the agent is going in circles. " +
		"If the agent is doing fine, respond with 'No advice needed.' " +
		"Keep your response under 500 words. No fluff.",
	tools: ["read", "bash", "grep", "find"],
	strategy: "single",
};

export interface AdvisorConfig {
	/** Override the subagent runner (for tests). */
	runner?: typeof runSubagent;
	/** Override hardness threshold (0-100). */
	threshold?: number;
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
	private _active: Promise<void> | null = null;
	private _abortController: AbortController | null = null;
	private _turnsSinceLastReview = 0;
	private _lastHardness = 0;

	constructor(config: AdvisorConfig = {}) {
		this._runner = config.runner ?? runSubagent;
		this._threshold = config.threshold ?? HARDNESS_THRESHOLD;
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

		const task = buildAdvisorTask(conversation, hardness);
		const opts: RunSubagentOptions = {
			preset: ADVISOR_PRESET,
			task,
			model,
			cwd,
			signal: this._abortController.signal,
			timeoutMs: 90000,
		};

		this._active = this._runner(opts)
			.then((result) => {
				if (result.output && !result.output.trim().startsWith("No advice")) {
					onAdvice(result.output.trim());
				}
			})
			.catch(() => {})
			.finally(() => {
				this._active = null;
				this._abortController = null;
			});
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

function buildAdvisorTask(conversation: string, hardness: number): string {
	return (
		`Review the following agent conversation. Session hardness score: ${hardness}/100.\n\n` +
		`Check for:\n` +
		`1. Is the agent over-engineering? Could the task be done more simply?\n` +
		`2. Is the agent making unverified assumptions about the codebase?\n` +
		`3. Is the agent going in circles or repeating the same approach?\n` +
		`4. Are there potential bugs or edge cases the agent is missing?\n` +
		`5. Should the agent delegate to a subagent or use a different tool?\n\n` +
		`Conversation:\n${conversation}\n\n` +
		`Provide specific, actionable advice. If the agent is on track, say "No advice needed."`
	);
}
