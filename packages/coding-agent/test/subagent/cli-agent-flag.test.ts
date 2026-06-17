import { registerFauxProvider } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { parseArgs } from "../../src/cli/args.ts";
import { AuthStorage } from "../../src/core/auth-storage.ts";
import {
	createAgentSessionFromServices,
	createAgentSessionServices,
} from "../../src/core/agent-session-services.ts";
import { ModelRegistry } from "../../src/core/model-registry.ts";
import { SettingsManager } from "../../src/core/settings-manager.ts";
import { DEEP_WORK } from "../../src/core/subagent/presets.ts";
import { SessionManager } from "../../src/core/session-manager.ts";
import { buildSessionOptions } from "../../src/main.ts";

function buildOptionsFor(args: string[]) {
	const parsed = parseArgs(args);
	const authStorage = AuthStorage.inMemory();
	const settingsManager = SettingsManager.inMemory();
	const modelRegistry = ModelRegistry.inMemory(authStorage);
	return buildSessionOptions(parsed, [], false, modelRegistry, settingsManager).options;
}

describe("--agent flag wiring", () => {
	it("--agent deep-work sets enableSubagents:true on the session options", () => {
		expect(buildOptionsFor(["--agent", "deep-work"]).enableSubagents).toBe(true);
		expect(buildOptionsFor(["--agent", "simple"]).enableSubagents).toBe(true);
	});

	it("default (no --agent) leaves enableSubagents unset", () => {
		expect(buildOptionsFor([]).enableSubagents).toBeUndefined();
	});

	it("end-to-end (offline): --agent deep-work yields a session with spawn_agent AND the persona prompt; default has neither", async () => {
		const faux = registerFauxProvider({
			models: [{ id: "faux-1", cost: { input: 0.000001, output: 0.000002, cacheRead: 0, cacheWrite: 0 } }],
		});
		try {
			const model = faux.getModel();
			const authStorage = AuthStorage.inMemory();
			authStorage.setRuntimeApiKey(model.provider, "faux-key");
			const cwd = process.cwd();

			// --agent deep-work: persona appended + subagents enabled (exactly what main builds).
			const agentServices = await createAgentSessionServices({
				cwd,
				authStorage,
				settingsManager: SettingsManager.inMemory(),
				resourceLoaderOptions: {
					noExtensions: true,
					noSkills: true,
					noPromptTemplates: true,
					noThemes: true,
					noContextFiles: true,
					appendSystemPrompt: [DEEP_WORK.systemPrompt],
				},
			});
			expect(agentServices.resourceLoader.getAppendSystemPrompt()).toContain(DEEP_WORK.systemPrompt);

			const agentSession = await createAgentSessionFromServices({
				services: agentServices,
				sessionManager: SessionManager.inMemory(cwd),
				model,
				enableSubagents: true,
			});
			try {
				expect(agentSession.session.getAllTools().map((t) => t.name)).toContain("spawn_agent");
			} finally {
				agentSession.session.dispose();
			}

			// Default: no persona append, no spawn_agent.
			const defaultServices = await createAgentSessionServices({
				cwd,
				authStorage,
				settingsManager: SettingsManager.inMemory(),
				resourceLoaderOptions: {
					noExtensions: true,
					noSkills: true,
					noPromptTemplates: true,
					noThemes: true,
					noContextFiles: true,
				},
			});
			expect(defaultServices.resourceLoader.getAppendSystemPrompt()).not.toContain(DEEP_WORK.systemPrompt);

			const defaultSession = await createAgentSessionFromServices({
				services: defaultServices,
				sessionManager: SessionManager.inMemory(cwd),
				model,
			});
			try {
				expect(defaultSession.session.getAllTools().map((t) => t.name)).not.toContain("spawn_agent");
			} finally {
				defaultSession.session.dispose();
			}
		} finally {
			faux.unregister();
		}
	}, 60000);
});
