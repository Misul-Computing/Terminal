import { registerFauxProvider } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { parseArgs } from "../../src/cli/args.ts";
import { AuthStorage } from "../../src/core/auth-storage.ts";
import { ModelRegistry } from "../../src/core/model-registry.ts";
import { createAgentSession } from "../../src/core/sdk.ts";

function createFauxRig() {
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

describe("subagent wiring", () => {
	it("does NOT inject spawn_agent by default (opt-in)", async () => {
		const rig = createFauxRig();
		try {
			const { session } = await createAgentSession({
				cwd: process.cwd(),
				model: rig.model,
				authStorage: rig.authStorage,
				modelRegistry: rig.modelRegistry,
			});
			try {
				expect(session.getAllTools().map((t) => t.name)).not.toContain("spawn_agent");
			} finally {
				session.dispose();
			}
		} finally {
			rig.faux.unregister();
		}
	}, 60000);

	it("exposes spawn_agent when enableSubagents:true", async () => {
		const rig = createFauxRig();
		try {
			const { session } = await createAgentSession({
				cwd: process.cwd(),
				model: rig.model,
				enableSubagents: true,
				authStorage: rig.authStorage,
				modelRegistry: rig.modelRegistry,
			});
			try {
				expect(session.getAllTools().map((t) => t.name)).toContain("spawn_agent");
			} finally {
				session.dispose();
			}
		} finally {
			rig.faux.unregister();
		}
	}, 60000);

	it("RECURSION GUARD: enableSubagents:false suppresses spawn_agent", async () => {
		const rig = createFauxRig();
		try {
			const { session } = await createAgentSession({
				cwd: process.cwd(),
				model: rig.model,
				enableSubagents: false,
				authStorage: rig.authStorage,
				modelRegistry: rig.modelRegistry,
			});
			try {
				expect(session.getAllTools().map((t) => t.name)).not.toContain("spawn_agent");
			} finally {
				session.dispose();
			}
		} finally {
			rig.faux.unregister();
		}
	}, 60000);

	it("parseArgs reads --agent <name>", () => {
		expect(parseArgs(["--agent", "deep-work"]).agent).toBe("deep-work");
		expect(parseArgs(["--agent", "simple"]).agent).toBe("simple");
		expect(parseArgs([]).agent).toBeUndefined();
	});

	it("parseArgs warns on an unknown --agent value", () => {
		const parsed = parseArgs(["--agent", "bogus"]);
		expect(parsed.agent).toBeUndefined();
		expect(parsed.diagnostics.some((d) => d.message.toLowerCase().includes("agent"))).toBe(true);
	});
});
