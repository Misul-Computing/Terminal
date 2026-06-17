/**
 * Subagent mechanism types.
 *
 * A subagent is a fresh headless AgentSession spawned in-process by the
 * `spawn_agent` tool. It inherits the parent's model, runs with a tool subset,
 * and returns its final text plus authoritative cost. Presets are plain data,
 * not subclasses.
 */

import type { Model } from "@earendil-works/pi-ai";
import type { AuthStorage } from "../auth-storage.ts";
import type { ModelRegistry } from "../model-registry.ts";
import type { createAgentSession } from "../sdk.ts";
import type { ToolName } from "../tools/index.ts";

/** Identifier of a built-in preset. */
export type AgentName = "simple" | "deep-work";

/** Orchestration strategy a preset runs under. */
export type AgentStrategy = "single" | "deep-work";

/** A built-in agent preset: a named role with a prompt, tool subset, and strategy. */
export interface AgentPreset {
	name: AgentName;
	/** One-line role description (surfaced in the spawn_agent tool docs). */
	description: string;
	/** System prompt prepended to the child task. */
	systemPrompt: string;
	/** Tool subset the child session may use. */
	tools: ToolName[];
	/** How the child is driven: single-pass or the deep-work phase loop. */
	strategy: AgentStrategy;
}

/** Token usage aggregated across a subagent run. */
export interface SubagentTokens {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	total: number;
}

/** Outcome of running a subagent (single run or full deep-work loop). */
export interface SubagentRunResult {
	/** Which preset ran. */
	agent: AgentName;
	/** Final assistant text from the child. */
	output: string;
	/** Authoritative dollar cost from getSessionStats(). */
	costUsd: number;
	tokens: SubagentTokens;
	durationMs: number;
	/** Phases that executed (deep-work: spec/plan/execute/review; single: ["execute"]). */
	phases: string[];
	errored: boolean;
	errorMessage?: string;
	/** Non-fatal advisory (e.g. deep-work accepted an unmarked review verdict). */
	note?: string;
}

/** Arguments to the `spawn_agent` tool. */
export interface SpawnAgentArgs {
	/** Preset selector. */
	agent: AgentName;
	/** Task description handed to the child. */
	task: string;
	/** Optional tool subset override (defaults to the preset's tools). */
	tools?: ToolName[];
}

/** Input to a single subagent run. */
export interface RunSubagentInput {
	preset: AgentPreset;
	task: string;
	/** Model inherited from the parent; the child never re-resolves a default. */
	model: Model<any>;
	cwd: string;
	/** Tool subset override (defaults to the preset's tools). */
	tools?: ToolName[];
	/** Parent abort signal: aborting the parent aborts the child. */
	signal?: AbortSignal;
}

/** Runs one subagent. Injected so deep-work and the spawn tool can be tested with a stub. */
export type SubagentRunner = (input: RunSubagentInput) => Promise<SubagentRunResult>;

/**
 * Test seams for {@link runSubagent}. Production passes none of these; offline
 * tests inject a faux auth/model registry and a spy session factory.
 */
export interface RunSubagentOptions extends RunSubagentInput {
	/** Hard cap on the child prompt; on overrun the run is aborted and marked errored. */
	timeoutMs?: number;
	authStorage?: AuthStorage;
	modelRegistry?: ModelRegistry;
	/** Isolated agent dir for offline tests so child session creation skips real extension discovery. */
	agentDir?: string;
	createSession?: typeof createAgentSession;
}

/** True when a run completed without error. */
export function isSubagentSuccess(result: SubagentRunResult): boolean {
	return !result.errored;
}
