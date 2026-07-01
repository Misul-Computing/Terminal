/**
 * The `spawn_agent` tool: an LLM-callable seam that runs a built-in preset as a
 * headless subagent (parent model inherited) and returns its final text + cost.
 *
 * Selection is by `agent` (a preset name); deep-work presets route through the
 * deep-work loop, others through a single run. Errors (unknown agent, no model)
 * are returned as tool results, not thrown.
 */

import type { AgentToolResult } from "@misul/agent-core";
import type { Model } from "@misul/ai";
import { type Static, Type } from "typebox";
import { defineTool, type ToolDefinition } from "../extensions/types.ts";
import { allToolNames, type ToolName } from "../tools/index.ts";
import { runAutoReview } from "./autoreview.ts";
import { runDeepWork } from "./deep-work.ts";
import { getPreset, PRESET_NAMES } from "./presets.ts";
import { runSubagent } from "./runner.ts";
import type { SubagentRunner, SubagentRunResult } from "./types.ts";

/**
 * Validate an LLM-supplied `tools` override before it crosses into the child.
 *
 * An empty array is ignored (fall back to the preset's tools); unknown tool
 * names are dropped with a warning rather than silently crippling the child.
 * Returns undefined when no usable override remains so callers default to the
 * preset.
 */
function sanitizeToolsOverride(tools: string[] | undefined): ToolName[] | undefined {
	if (!tools || tools.length === 0) return undefined;
	const known: ToolName[] = [];
	const unknown: string[] = [];
	for (const name of tools) {
		if (allToolNames.has(name as ToolName)) known.push(name as ToolName);
		else unknown.push(name);
	}
	if (unknown.length > 0) {
		console.warn(`spawn_agent: dropping unknown tool name(s): ${unknown.join(", ")}`);
	}
	return known.length > 0 ? known : undefined;
}

export interface CreateSpawnAgentToolOptions {
	/** Runner for a single subagent run. Defaults to the real {@link runSubagent}. */
	runner?: SubagentRunner;
	/** Fallback model accessor when ctx.model is undefined (wired in sdk.ts to agent.state.model). */
	getParentModel?: () => Model<any> | undefined;
	/** Run autoreview after work subagents (simple, deep-work). Default: false. */
	autoReview?: boolean;
}

const spawnAgentParameters = Type.Object({
	agent: Type.Union([Type.Literal("simple"), Type.Literal("deep-work"), Type.Literal("review")], {
		description: "Which built-in agent to run.",
	}),
	task: Type.String({ description: "The task to delegate to the subagent." }),
	tools: Type.Optional(
		Type.Array(Type.String(), { description: "Optional tool subset override (defaults to the preset's tools)." }),
	),
});

type SpawnAgentParams = Static<typeof spawnAgentParameters>;

function textResult(text: string, details: SubagentRunResult | undefined): AgentToolResult<SubagentRunResult | undefined> {
	return { content: [{ type: "text", text }], details };
}

export function createSpawnAgentTool(options: CreateSpawnAgentToolOptions = {}): ToolDefinition {
	const runner = options.runner ?? runSubagent;

	return defineTool({
		name: "spawn_agent",
		label: "Spawn Agent",
		description:
			"Delegate a task to a built-in subagent that runs headlessly with your model. " +
			"`simple` does a single pass; `deep-work` runs spec, plan, execute, and review.",
		promptSnippet: "spawn_agent(agent, task): delegate to a built-in subagent (simple | deep-work).",
		executionMode: "sequential",
		parameters: spawnAgentParameters,
		execute: async (_toolCallId, params: SpawnAgentParams, signal, _onUpdate, ctx) => {
			const preset = getPreset(params.agent);
			if (!preset) {
				return textResult(`Unknown agent "${params.agent}". Available: ${PRESET_NAMES.join(", ")}.`, undefined);
			}

			const model = ctx?.model ?? options.getParentModel?.();
			if (!model) {
				return textResult("Cannot spawn subagent: no model available to inherit.", undefined);
			}

			const cwd = ctx?.cwd ?? process.cwd();
			const tools = sanitizeToolsOverride(params.tools);

			const result =
				preset.strategy === "deep-work"
					? await runDeepWork({ task: params.task, model, cwd, preset, runner, tools, signal: signal ?? undefined })
					: await runner({ preset, task: params.task, model, cwd, tools, signal: signal ?? undefined });

			if (options.autoReview && !result.errored && (params.agent === "simple" || params.agent === "deep-work")) {
				const reviewed = await runAutoReview({
					task: params.task,
					workResult: result,
					model,
					cwd,
					runner,
					signal: signal ?? undefined,
				});
				return textResult(formatResult(reviewed), reviewed);
			}

			return textResult(formatResult(result), result);
		},
	});
}

function formatResult(result: SubagentRunResult): string {
	const cost = Number.isFinite(result.costUsd) ? `$${result.costUsd.toFixed(6)}` : "n/a";
	return result.errored
		? `Subagent "${result.agent}" failed: ${result.errorMessage ?? "unknown error"}`
		: `Subagent "${result.agent}" finished (phases: ${result.phases.join(", ")}, cost: ${cost}).\n\n${result.output}`;
}
