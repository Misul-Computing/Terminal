/**
 * Background review loop: after every N user turns, spawn a restricted
 * subagent that reviews the conversation and updates memory or creates skills.
 *
 * Adapted from Hermes Agent's nudge system. The review agent runs in the
 * background (not awaited), uses a restricted toolset (read/write/edit),
 * and is told to only touch memory and skill files.
 */

import type { AgentMessage } from "@misul/agent-core";
import type { Model } from "@misul/ai";
import { getAgentDir } from "../config.ts";
import { REVIEW } from "./subagent/presets.ts";
import { runSubagent } from "./subagent/runner.ts";
import type { RunSubagentOptions } from "./subagent/types.ts";

/** Default: review every 10 user turns. */
const DEFAULT_NUDGE_INTERVAL = 10;

/** Max conversation chars passed to the review agent (keeps cost down). */
const MAX_CONVERSATION_CHARS = 12000;

export interface BackgroundReviewConfig {
	/** Review every N user turns. 0 disables. */
	nudgeInterval?: number;
	/** Override the subagent runner (for tests). */
	runner?: typeof runSubagent;
}

export class BackgroundReviewLoop {
	private _turnCount = 0;
	private _nudgeInterval: number;
	private _runner: typeof runSubagent;
	private _active: Promise<void> | null = null;
	private _abortController: AbortController | null = null;

	constructor(config: BackgroundReviewConfig = {}) {
		this._nudgeInterval = config.nudgeInterval ?? DEFAULT_NUDGE_INTERVAL;
		this._runner = config.runner ?? runSubagent;
	}

	/** Call after each user turn completes. Spawns review if threshold hit. */
	maybeReview(
		messages: AgentMessage[],
		model: Model<any>,
		cwd: string,
		onIssue?: (issue: string) => void,
		signal?: AbortSignal,
	): void {
		if (this._nudgeInterval <= 0) return;
		if (this._active) return; // don't overlap reviews

		this._turnCount++;
		if (this._turnCount < this._nudgeInterval) return;

		this._turnCount = 0;
		const conversation = serializeConversation(messages);
		if (!conversation) return;

		const agentDir = getAgentDir();
		const task = buildReviewTask(conversation, agentDir);

		this._abortController = new AbortController();
		const reviewSignal = this._abortController.signal;
		// If the caller provides a signal, also abort when it fires.
		if (signal) {
			signal.addEventListener("abort", () => this._abortController?.abort(), { once: true });
		}

		const opts: RunSubagentOptions = {
			preset: REVIEW,
			task,
			model,
			cwd,
			signal: reviewSignal,
			timeoutMs: 120000,
		};

		this._active = this._runner(opts)
			.then((result) => {
				if (result.errored) {
					console.warn(`background-review: review agent error: ${result.errorMessage ?? "unknown"}`);
					return;
				}
				const output = result.output.trim();
				if (output && !output.toLowerCase().startsWith("nothing to save")) {
					console.warn(`background-review: found issues worth flagging`);
					onIssue?.(`[background-review] ${output}`);
				}
			})
			.catch((err) => {
				console.warn(`background-review: failed: ${err instanceof Error ? err.message : String(err)}`);
			})
			.finally(() => { this._active = null; this._abortController = null; });
	}

	/** Abort any running review. Call on session dispose to prevent orphaned writes. */
	dispose(): void {
		this._abortController?.abort();
		this._abortController = null;
		this._active = null;
		this._turnCount = 0;
	}

	/** True if a background review is currently running. */
	get isRunning(): boolean {
		return this._active !== null;
	}
}

/** Extract recent text from messages, newest first, up to MAX_CONVERSATION_CHARS. */
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

function buildReviewTask(conversation: string, agentDir: string): string {
	return (
		`Review the following conversation. You have one job.\n\n` +
		`## HONESTY CHECK\n` +
		`Read the assistant's responses carefully and check for:\n` +
		`- Sycophancy: did the assistant agree with the user when it should have pushed back?\n` +
		`- Unverified claims: did the assistant state things about the codebase, libraries, or APIs ` +
		`without actually reading the code or docs to verify?\n` +
		`- Overconfidence: did the assistant present guesses as facts, or omit uncertainty?\n` +
		`- Missed errors: did the assistant make factual claims that are wrong?\n\n` +
		`If you find problems, add them to MEMORY.md under a "## honesty_flags" section with the ` +
		`specific claim and why it's wrong or unverified. This helps the agent calibrate future responses.\n\n` +
		`## KNOWLEDGE CAPTURE\n` +
		`Memory file: ${agentDir}/memory/MEMORY.md\n\n` +
		`Decide: should any facts, conventions, or lessons be added to or updated in MEMORY.md?\n` +
		`Keep MEMORY.md under 2200 characters. Replace outdated entries, don't just append.\n\n` +
		`Conversation:\n${conversation}\n\n` +
		`Make the edits if needed. If nothing is worth saving and no honesty issues found, ` +
		`respond with "Nothing to save."`
	);
}
