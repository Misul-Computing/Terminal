/**
 * Run one subagent: a fresh headless AgentSession that inherits the parent's
 * model, runs with a tool subset, returns its final text + authoritative cost,
 * and is always disposed.
 *
 * Adapted from the proven SP-1 eval runner (timeout / abort / dispose-in-finally
 * / getSessionStats cost with a NaN guard), simplified: no run-dir cloning and
 * no run-collector cross-check (getSessionStats is authoritative here).
 *
 * Recursion guard: the child session is created with `enableSubagents: false`,
 * so it never exposes `spawn_agent` and cannot delegate further.
 */

import type { AssistantMessage } from "@earendil-works/pi-ai";
import { createAgentSession, type CreateAgentSessionResult } from "../sdk.ts";
import { SessionManager } from "../session-manager.ts";
import type { RunSubagentOptions, SubagentRunResult } from "./types.ts";

const DEFAULT_TIMEOUT_MS = 300000;

export async function runSubagent(options: RunSubagentOptions): Promise<SubagentRunResult> {
	const { preset, task, model, cwd } = options;
	const tools = options.tools ?? preset.tools;
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const createSession = options.createSession ?? createAgentSession;
	const start = Date.now();

	const base: SubagentRunResult = {
		agent: preset.name,
		output: "",
		costUsd: 0,
		tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		durationMs: 0,
		phases: ["execute"],
		errored: false,
	};

	let created: CreateAgentSessionResult;
	try {
		created = await createSession({
			cwd,
			model,
			tools,
			enableSubagents: false,
			sessionManager: SessionManager.inMemory(cwd),
			...(options.authStorage ? { authStorage: options.authStorage } : {}),
			...(options.modelRegistry ? { modelRegistry: options.modelRegistry } : {}),
			...(options.agentDir ? { agentDir: options.agentDir } : {}),
		});
	} catch (err) {
		return { ...base, durationMs: Date.now() - start, errored: true, errorMessage: errorText(err) };
	}

	const { session } = created;
	// Parent abort drives the child to idle (matches how the real provider honors abort).
	const parentSignal = options.signal;
	// Await + swallow: a throwing abort must not surface as an unhandled rejection.
	const onParentAbort = async () => {
		await session.abort().catch(() => {});
	};
	try {
		// Already cancelled: don't start work the caller has abandoned.
		if (parentSignal?.aborted) {
			return { ...base, durationMs: Date.now() - start, errored: true, errorMessage: "subagent aborted by parent" };
		}
		parentSignal?.addEventListener("abort", onParentAbort, { once: true });

		let lastText = "";
		const unsubscribe = session.subscribe((event) => {
			if (event.type !== "message_end") return;
			const message = event.message;
			if (!isAssistantMessage(message)) return;
			const text = assistantText(message);
			if (text) lastText = text;
		});

		let timedOut = false;
		try {
			let timer: NodeJS.Timeout | undefined;
			const timeout = new Promise<never>((_resolve, reject) => {
				timer = setTimeout(() => {
					timedOut = true;
					reject(new Error(`subagent prompt exceeded ${timeoutMs}ms`));
				}, timeoutMs);
			});
			try {
				await Promise.race([session.prompt(`${preset.systemPrompt}\n\n${task}`), timeout]);
			} finally {
				if (timer) clearTimeout(timer);
			}
		} catch (err) {
			if (timedOut) await session.abort();
			return { ...base, durationMs: Date.now() - start, errored: true, errorMessage: errorText(err) };
		} finally {
			unsubscribe();
		}

		if (parentSignal?.aborted) {
			return {
				...base,
				durationMs: Date.now() - start,
				errored: true,
				errorMessage: "subagent aborted by parent",
			};
		}

		const stats = safeSessionStats(session);
		return {
			...base,
			output: lastText,
			costUsd: Number.isFinite(stats.cost) ? stats.cost : 0,
			tokens: {
				input: stats.tokens.input,
				output: stats.tokens.output,
				cacheRead: stats.tokens.cacheRead,
				cacheWrite: stats.tokens.cacheWrite,
				total: stats.tokens.total,
			},
			durationMs: Date.now() - start,
			errored: false,
		};
	} catch (err) {
		return { ...base, durationMs: Date.now() - start, errored: true, errorMessage: errorText(err) };
	} finally {
		if (parentSignal) parentSignal.removeEventListener("abort", onParentAbort);
		session.dispose();
	}
}

interface SafeStats {
	cost: number;
	tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
}

/** getSessionStats dereferences usage.cost.total; guard so a missing cost degrades to NaN. */
function safeSessionStats(session: { getSessionStats: () => SafeStats }): SafeStats {
	try {
		return session.getSessionStats();
	} catch {
		return { cost: Number.NaN, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
	}
}

function assistantText(message: AssistantMessage): string {
	return message.content
		.filter((block): block is Extract<AssistantMessage["content"][number], { type: "text" }> => block.type === "text")
		.map((block) => block.text)
		.join("\n")
		.trim();
}

function isAssistantMessage(message: { role?: string }): message is AssistantMessage {
	return message.role === "assistant";
}

function errorText(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}
