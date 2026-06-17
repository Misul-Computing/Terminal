/**
 * Subagent mechanism: spawn_agent tool + built-in presets.
 *
 * NOTE: this "subagent" is the in-process `spawn_agent` delegation mechanism and
 * is distinct from the pre-existing rpc-subagents feature (the naming collision
 * is intentional and not renamed).
 */

export type {
	AgentName,
	AgentPreset,
	AgentStrategy,
	RunSubagentInput,
	SpawnAgentArgs,
	SubagentRunResult,
	SubagentRunner,
	SubagentTokens,
} from "./types.ts";
export type { RunSubagentOptions } from "./types.ts";
export { isSubagentSuccess } from "./types.ts";
export { DEEP_WORK, getPreset, listPresets, PRESET_NAMES, SIMPLE } from "./presets.ts";
export { runSubagent } from "./runner.ts";
export { type RunDeepWorkInput, runDeepWork } from "./deep-work.ts";
export { type CreateSpawnAgentToolOptions, createSpawnAgentTool } from "./spawn-tool.ts";
