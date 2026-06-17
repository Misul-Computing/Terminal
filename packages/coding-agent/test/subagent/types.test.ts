import { describe, expect, it } from "vitest";
import {
	type AgentPreset,
	isSubagentSuccess,
	type SpawnAgentArgs,
	type SubagentRunResult,
} from "../../src/core/subagent/index.ts";

describe("subagent types", () => {
	it("AgentPreset captures name, prompt, tools, and strategy", () => {
		const preset: AgentPreset = {
			name: "simple",
			description: "single-pass helper",
			systemPrompt: "do the thing",
			tools: ["read", "bash"],
			strategy: "single",
		};
		expect(preset.name).toBe("simple");
		expect(preset.tools).toContain("read");
		expect(preset.strategy).toBe("single");
	});

	it("SpawnAgentArgs carries the selector, task, and optional tool subset", () => {
		const args: SpawnAgentArgs = { agent: "deep-work", task: "refactor", tools: ["read"] };
		expect(args.agent).toBe("deep-work");
		expect(args.task).toBe("refactor");
		expect(args.tools).toEqual(["read"]);
	});

	it("isSubagentSuccess returns false for an errored result", () => {
		const errored: SubagentRunResult = {
			agent: "simple",
			output: "",
			costUsd: 0,
			tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			durationMs: 5,
			phases: [],
			errored: true,
			errorMessage: "boom",
		};
		expect(isSubagentSuccess(errored)).toBe(false);
	});

	it("isSubagentSuccess returns true for a clean result", () => {
		const ok: SubagentRunResult = {
			agent: "deep-work",
			output: "done",
			costUsd: 0.01,
			tokens: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, total: 15 },
			durationMs: 12,
			phases: ["execute"],
			errored: false,
		};
		expect(isSubagentSuccess(ok)).toBe(true);
		expect(ok.output).toBe("done");
	});
});
