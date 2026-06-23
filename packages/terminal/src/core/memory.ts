/**
 * Misul's persistent agent memory.
 *
 * Durable knowledge that survives across sessions, stored under the agent dir
 * and injected into the system prompt at session start. Kept deliberately simple:
 * a single Markdown file, no database, no index — the model reads and maintains it
 * directly via its file tools. There is no automated offline consolidation pass
 * yet; the model itself is responsible for keeping the file accurate and concise.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Directory holding persistent memory, under the agent dir (e.g. ~/.misul/agent/memory). */
export function getMemoryDir(agentDir: string): string {
	return join(agentDir, "memory");
}

/** The main memory file injected into the system prompt and rewritten by dreaming. */
export function getMemoryPath(agentDir: string): string {
	return join(getMemoryDir(agentDir), "MEMORY.md");
}

/** Loaded persistent memory: its absolute path plus the current content. */
export interface LoadedMemory {
	path: string;
	content: string;
}

/** Load persistent memory, or undefined when there is none yet (or it is empty). */
export function loadMemory(agentDir: string): LoadedMemory | undefined {
	const path = getMemoryPath(agentDir);
	if (!existsSync(path)) return undefined;
	try {
		const content = readFileSync(path, "utf-8").trim();
		return content.length > 0 ? { path, content } : undefined;
	} catch {
		return undefined;
	}
}
