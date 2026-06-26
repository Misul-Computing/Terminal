/**
 * Standalone JSONL session aggregator. Folds a misul session log into a single
 * cost/token rollup by summing assistant-message usage. Independent of the
 * SDK (no in-process state) so it can cross-check `getSessionStats()` and be
 * run over persisted session files. Tolerant of blank/partial lines so a
 * truncated log never throws.
 */

import type { TokenUsage } from "./types.ts";

export interface SessionAggregate {
	costUsd: number;
	tokens: TokenUsage;
	assistantMessages: number;
}

export function aggregateSessionJsonl(jsonl: string): SessionAggregate {
	let costUsd = 0;
	let input = 0;
	let output = 0;
	let cacheRead = 0;
	let cacheWrite = 0;
	let assistantMessages = 0;

	for (const line of jsonl.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		let entry: { type?: string; message?: { role?: string; usage?: Record<string, unknown> } };
		try {
			entry = JSON.parse(trimmed);
		} catch {
			continue;
		}
		const message = entry.message;
		if (entry.type !== "message" || message?.role !== "assistant") continue;
		const usage = message.usage ?? {};
		input += Number(usage.input) || 0;
		output += Number(usage.output) || 0;
		cacheRead += Number(usage.cacheRead) || 0;
		cacheWrite += Number(usage.cacheWrite) || 0;
		const cost = usage.cost as { total?: unknown } | undefined;
		costUsd += Number(cost?.total) || 0;
		assistantMessages += 1;
	}

	return {
		costUsd,
		tokens: { input, output, cacheRead, cacheWrite, total: input + output + cacheRead + cacheWrite },
		assistantMessages,
	};
}
