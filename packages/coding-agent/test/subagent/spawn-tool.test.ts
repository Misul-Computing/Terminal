import { fauxAssistantMessage, fauxToolCall, registerFauxProvider } from "@misul/ai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuthStorage } from "../../src/core/auth-storage.ts";
import { ModelRegistry } from "../../src/core/model-registry.ts";
import { createAgentSession } from "../../src/core/sdk.ts";
import { createSpawnAgentTool } from "../../src/core/subagent/spawn-tool.ts";
import type { RunSubagentInput, SubagentRunResult } from "../../src/core/subagent/types.ts";

interface FauxRig {
	faux: ReturnType<typeof registerFauxProvider>;
	authStorage: AuthStorage;
	modelRegistry: ModelRegistry;
	model: ReturnType<ReturnType<typeof registerFauxProvider>["getModel"]>;
}

function createFauxRig(): FauxRig {
	const faux = registerFauxProvider({
		models: [{ id: "faux-1", cost: { input: 0.000001, output: 0.000002, cacheRead: 0, cacheWrite: 0 } }],
	});
	const model = faux.getModel();
	const authStorage = AuthStorage.inMemory();
	authStorage.setRuntimeApiKey(model.provider, "faux-key");
	const modelRegistry = ModelRegistry.inMemory(authStorage);
	modelRegistry.registerProvider(model.provider, {
		baseUrl: model.baseUrl,
		apiKey: "faux-key",
		api: faux.api,
		models: faux.models.map((m) => ({
			id: m.id,
			name: m.name,
			api: m.api,
			reasoning: m.reasoning,
			input: m.input,
			cost: m.cost,
			contextWindow: m.contextWindow,
			maxTokens: m.maxTokens,
			baseUrl: m.baseUrl,
		})),
	});
	return { faux, authStorage, modelRegistry, model };
}

function stubResult(over: Partial<SubagentRunResult> = {}): SubagentRunResult {
	return {
		agent: "simple",
		output: "child output",
		costUsd: 0.005,
		tokens: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, total: 2 },
		durationMs: 1,
		phases: ["execute"],
		errored: false,
		...over,
	};
}

describe("createSpawnAgentTool (real parent session, faux)", () => {
	let rig: FauxRig;

	beforeEach(() => {
		rig = createFauxRig();
	});

	afterEach(() => {
		rig.faux.unregister();
	});

	it("the parent LLM calls spawn_agent, the child inherits the parent model, and the result reaches the parent transcript", async () => {
		const seen: RunSubagentInput[] = [];
		const runner = async (input: RunSubagentInput): Promise<SubagentRunResult> => {
			seen.push(input);
			return stubResult({ output: "delegated work done" });
		};
		const tool = createSpawnAgentTool({ runner });

		const { session } = await createAgentSession({
			cwd: process.cwd(),
			model: rig.model,
			tools: ["spawn_agent"],
			customTools: [tool],
			enableSubagents: false, // avoid double injection; we register the tool explicitly
			authStorage: rig.authStorage,
			modelRegistry: rig.modelRegistry,
		});

		try {
			rig.faux.setResponses([
				fauxAssistantMessage(fauxToolCall("spawn_agent", { agent: "simple", task: "do a small task" }), {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage("parent wraps up.", { stopReason: "stop" }),
			]);

			await session.prompt("delegate this");

			// Child inherited the parent's model.
			expect(seen.length).toBe(1);
			expect(seen[0].model.id).toBe(rig.model.id);
			expect(seen[0].task).toContain("do a small task");

			// The child's output reached the parent transcript via the tool result.
			const toolResults = session.messages.filter((m) => m.role === "toolResult");
			const text = JSON.stringify(toolResults);
			expect(text).toContain("delegated work done");
		} finally {
			session.dispose();
		}
		// Real session I/O; allow headroom over vitest's 30s default under load.
	}, 60000);

	it("routes deep-work to the deep-work loop (multiple runner calls)", async () => {
		let calls = 0;
		const runner = async (_input: RunSubagentInput): Promise<SubagentRunResult> => {
			calls++;
			return stubResult({ agent: "deep-work", output: "REVIEW: PASS ok" });
		};
		const tool = createSpawnAgentTool({ runner });

		const { session } = await createAgentSession({
			cwd: process.cwd(),
			model: rig.model,
			tools: ["spawn_agent"],
			customTools: [tool],
			enableSubagents: false,
			authStorage: rig.authStorage,
			modelRegistry: rig.modelRegistry,
		});

		try {
			rig.faux.setResponses([
				fauxAssistantMessage(fauxToolCall("spawn_agent", { agent: "deep-work", task: "ship a feature" }), {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage("done.", { stopReason: "stop" }),
			]);

			await session.prompt("delegate deep work");

			// deep-work ran spec, plan, execute, review = 4 runner calls.
			expect(calls).toBe(4);
		} finally {
			session.dispose();
		}
		// Real session I/O; allow headroom over vitest's 30s default under load.
	}, 60000);

	it("returns an error result for an unknown agent name without throwing", async () => {
		const runner = async (): Promise<SubagentRunResult> => stubResult();
		const tool = createSpawnAgentTool({ runner });
		const ctx = { model: rig.model, cwd: process.cwd() } as Parameters<typeof tool.execute>[4];

		const result = await tool.execute("call-1", { agent: "nope", task: "x" } as never, undefined, undefined, ctx);
		const text = result.content.map((c) => (c.type === "text" ? c.text : "")).join("");
		expect(text.toLowerCase()).toContain("unknown agent");
	});

	it("returns an error result when no model is available", async () => {
		const runner = async (): Promise<SubagentRunResult> => stubResult();
		const tool = createSpawnAgentTool({ runner });
		const ctx = { model: undefined, cwd: process.cwd() } as Parameters<typeof tool.execute>[4];

		const result = await tool.execute("call-1", { agent: "simple", task: "x" } as never, undefined, undefined, ctx);
		const text = result.content.map((c) => (c.type === "text" ? c.text : "")).join("");
		expect(text.toLowerCase()).toContain("no model");
	});

	it("#5: ignores an empty tools:[] override (falls back to the preset's tools)", async () => {
		const seen: RunSubagentInput[] = [];
		const runner = async (input: RunSubagentInput): Promise<SubagentRunResult> => {
			seen.push(input);
			return stubResult();
		};
		const tool = createSpawnAgentTool({ runner });
		const ctx = { model: rig.model, cwd: process.cwd() } as Parameters<typeof tool.execute>[4];

		await tool.execute("call-1", { agent: "simple", task: "x", tools: [] } as never, undefined, undefined, ctx);
		// Empty override is dropped -> runner sees undefined -> runSubagent uses preset.tools.
		expect(seen[0]?.tools).toBeUndefined();
	});

	it("#5: drops unknown tool names from a tools override, keeping known ones", async () => {
		const warnings: string[] = [];
		const originalWarn = console.warn;
		console.warn = (msg?: unknown) => {
			warnings.push(String(msg));
		};
		try {
			const seen: RunSubagentInput[] = [];
			const runner = async (input: RunSubagentInput): Promise<SubagentRunResult> => {
				seen.push(input);
				return stubResult();
			};
			const tool = createSpawnAgentTool({ runner });
			const ctx = { model: rig.model, cwd: process.cwd() } as Parameters<typeof tool.execute>[4];

			await tool.execute(
				"call-1",
				{ agent: "simple", task: "x", tools: ["read", "bogus-tool"] } as never,
				undefined,
				undefined,
				ctx,
			);
			expect(seen[0]?.tools).toEqual(["read"]);
			expect(warnings.some((w) => w.includes("bogus-tool"))).toBe(true);
		} finally {
			console.warn = originalWarn;
		}
	});

	it("falls back to getParentModel when ctx.model is undefined", async () => {
		const seen: RunSubagentInput[] = [];
		const runner = async (input: RunSubagentInput): Promise<SubagentRunResult> => {
			seen.push(input);
			return stubResult();
		};
		const tool = createSpawnAgentTool({ runner, getParentModel: () => rig.model });
		const ctx = { model: undefined, cwd: process.cwd() } as Parameters<typeof tool.execute>[4];

		const result = await tool.execute("call-1", { agent: "simple", task: "x" } as never, undefined, undefined, ctx);
		expect(result.details).toBeDefined();
		expect(seen[0]?.model.id).toBe(rig.model.id);
	});
});
