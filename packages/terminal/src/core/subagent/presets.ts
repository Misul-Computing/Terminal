/**
 * Built-in subagent presets.
 *
 * NOTE: persona/system-prompt text is intentionally LIGHT and minimal — it is a
 * placeholder pending user refinement, not a finished persona.
 */

import type { AgentName, AgentPreset } from "./types.ts";

/** Single-pass worker for small, well-scoped tasks. */
export const SIMPLE: AgentPreset = {
	name: "simple",
	description: "Single-pass worker for small, well-scoped tasks.",
	systemPrompt:
		"You are a subagent. Do the task in one pass with the least code that works (the `ponytail` skill applies). Report what you did.",
	tools: ["read", "bash", "edit", "write"],
	strategy: "single",
};

/** Droid-factory deep-work agent: spec, plan, execute, review. */
export const DEEP_WORK: AgentPreset = {
	name: "deep-work",
	description: "Deep-work droid: spec then plan then execute then review.",
	systemPrompt:
		"You are a deep-work subagent. Work the phase you are given in order: spec, plan, execute, review. " +
		"Follow the `system-prompts` skill for prompt/spec quality and `ponytail` for the simplest solution that works. " +
		"In the review phase, end with `REVIEW: PASS` or `REVIEW: FAIL` and concrete feedback.",
	tools: ["read", "bash", "edit", "write", "grep", "find"],
	strategy: "deep-work",
};

/** Background review agent: updates memory and creates skills from conversation. */
export const REVIEW: AgentPreset = {
	name: "review",
	description: "Background review agent that extracts memory and creates skills from conversation history.",
	systemPrompt:
		"You are a background review agent. Your job is to review the conversation and update persistent memory or create skills.\n\n" +
		"Rules:\n" +
		"- ONLY write to the memory file (~/.misul/agent/memory/MEMORY.md) or skill files (~/.misul/skills/<name>/SKILL.md).\n" +
		"- NEVER modify source code, config files, or any other files.\n" +
		"- Memory should be concise: facts, conventions, lessons learned. Not conversation transcripts.\n" +
		"- Skills should capture reusable procedures: when to use them, step-by-step instructions.\n" +
		"- If nothing is worth saving, say so and do nothing.\n" +
		"- Keep MEMORY.md under 2200 characters. Replace outdated entries, don't just append.\n" +
		"- Skill files use YAML frontmatter (name, description) + markdown body. Name must be lowercase a-z, 0-9, hyphens.",
	tools: ["read", "write", "edit"],
	strategy: "single",
};

const PRESETS: AgentPreset[] = [SIMPLE, DEEP_WORK, REVIEW];

/** Resolve a preset by name. Returns undefined for unknown names. */
export function getPreset(name: string): AgentPreset | undefined {
	return PRESETS.find((preset) => preset.name === name);
}

/** All built-in presets. */
export function listPresets(): AgentPreset[] {
	return PRESETS;
}

/** Valid preset names (for CLI/schema validation). */
export const PRESET_NAMES: AgentName[] = PRESETS.map((preset) => preset.name);
