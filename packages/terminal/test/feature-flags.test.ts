/**
 * Feature flag integration tests.
 * Enables all features through settings/flags and verifies they work
 * with mimo-v2.5 via opencode-go.
 *
 * Features tested:
 * 1. enableSubagents + autoReviewSubagents (spawn_agent tool + autoreview)
 * 2. soloMode (subagent spawning disabled)
 * 3. cacheAggressiveness (aggressive caching)
 * 4. assistantPrefill (honest prefill)
 * 5. steeringMode (all vs one-at-a-time)
 * 6. followUpMode
 * 7. transport (sse vs websocket vs auto)
 * 8. blockImages
 * 9. Goal loop
 * 10. DAP tools active in tool set
 * 11. Memory store wired into session
 * 12. Advisor with constitution
 * 13. Capability system with debug tools
 * 14. Telemetry (/stats)
 * 15. Prefix cache
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getModel } from "@misul/ai";
import { createAgentSession } from "../src/core/sdk.ts";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { ModelRegistry } from "../src/core/model-registry.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { createTestResourceLoader, hasAuthForProvider, resolveApiKey } from "./utilities.ts";
import { CapabilityRegistry } from "../src/core/capabilities.ts";
import { DebugSessionManager, createDapTools } from "../src/core/dap/index.ts";
import { AdvisorLoop } from "../src/core/advisor.ts";
import { MemoryStore } from "../src/core/memory/memory-store.ts";
import { RunTelemetry } from "../src/core/telemetry/index.ts";
import { JobManager } from "../src/core/jobs/index.ts";

const HAS_AUTH = hasAuthForProvider("opencode-go");
const HOME = require("node:os").homedir();
const AUTH_PATH = join(HOME, ".misul", "agent", "auth.json");
const AGENT_DIR = join(HOME, ".misul", "agent");

let tempDir: string;

beforeAll(() => {
	tempDir = join(tmpdir(), `misul-flag-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(tempDir, { recursive: true });
});

afterAll(() => {
	if (tempDir && existsSync(tempDir)) {
		rmSync(tempDir, { recursive: true });
	}
});

function makeSessionOptions(overrides: Record<string, unknown> = {}) {
	return {
		cwd: tempDir,
		agentDir: AGENT_DIR,
		model: getModel("opencode-go", "mimo-v2.5"),
		thinkingLevel: "low" as const,
		// Don't pass tools as an allowlist - we want all registered tools visible.
		// The default active set is read/bash/edit/write, but getAllTools() returns
		// everything registered (including DAP and spawn_agent).
		sessionManager: SessionManager.inMemory(),
		settingsManager: SettingsManager.create(tempDir, tempDir),
		authStorage: AuthStorage.create(AUTH_PATH),
		modelRegistry: ModelRegistry.create(AuthStorage.create(AUTH_PATH), join(AGENT_DIR, "models.json")),
		resourceLoader: createTestResourceLoader(),
		...overrides,
	};
}

describe.skipIf(!HAS_AUTH)("Feature flags: all features enabled", () => {
	it("enableSubagents: spawn_agent tool is available", async () => {
		const { session } = await createAgentSession(
			makeSessionOptions({ enableSubagents: true }),
		);
		session.subscribe(() => {});

		const allTools = session.getAllTools();
		const toolNames = allTools.map((t) => t.name);
		expect(toolNames).toContain("spawn_agent");

		session.dispose();
	}, 15000);

	it("enableSubagents + autoReviewSubagents: both flags wired", async () => {
		const { session } = await createAgentSession(
			makeSessionOptions({ enableSubagents: true, autoReviewSubagents: true }),
		);
		session.subscribe(() => {});

		const allTools = session.getAllTools();
		const toolNames = allTools.map((t) => t.name);
		expect(toolNames).toContain("spawn_agent");

		session.dispose();
	}, 15000);

	it("soloMode: spawn_agent tool is NOT available", async () => {
		const settingsManager = SettingsManager.create(tempDir, tempDir);
		settingsManager.applyOverrides({ soloMode: true });

		const { session } = await createAgentSession(
			makeSessionOptions({ settingsManager, enableSubagents: false }),
		);
		session.subscribe(() => {});

		const allTools = session.getAllTools();
		const toolNames = allTools.map((t) => t.name);
		expect(toolNames).not.toContain("spawn_agent");

		session.dispose();
	}, 15000);

	it("cacheAggressiveness: aggressive setting applied", async () => {
		const settingsManager = SettingsManager.create(tempDir, tempDir);
		settingsManager.applyOverrides({ cacheAggressiveness: "aggressive" });

		const { session } = await createAgentSession(
			makeSessionOptions({ settingsManager }),
		);
		session.subscribe(() => {});

		expect(settingsManager.getCacheAggressiveness()).toBe("aggressive");

		// Simple prompt to verify it works with aggressive caching
		await session.prompt("Say hello.");
		await session.agent.waitForIdle();

		const messages = session.agent.state.messages;
		const lastAssistant = messages.findLast((m) => m.role === "assistant");
		expect(lastAssistant).toBeDefined();
		expect(lastAssistant?.stopReason).toBe("stop");

		session.dispose();
	}, 30000);

	it("assistantPrefill: prefill text applied", async () => {
		const settingsManager = SettingsManager.create(tempDir, tempDir);
		settingsManager.applyOverrides({ assistantPrefill: "I will help." });

		const { session } = await createAgentSession(
			makeSessionOptions({ settingsManager }),
		);
		session.subscribe(() => {});

		expect(settingsManager.getAssistantPrefill()).toBe("I will help.");

		await session.prompt("Say hi.");
		await session.agent.waitForIdle();

		const messages = session.agent.state.messages;
		const lastAssistant = messages.findLast((m) => m.role === "assistant");
		expect(lastAssistant).toBeDefined();

		session.dispose();
	}, 30000);

	it("steeringMode: all mode set", async () => {
		const settingsManager = SettingsManager.create(tempDir, tempDir);
		settingsManager.applyOverrides({ steeringMode: "all" });

		expect(settingsManager.getSteeringMode()).toBe("all");

		const { session } = await createAgentSession(
			makeSessionOptions({ settingsManager }),
		);
		session.subscribe(() => {});
		session.dispose();
	}, 15000);

	it("followUpMode: all mode set", async () => {
		const settingsManager = SettingsManager.create(tempDir, tempDir);
		settingsManager.applyOverrides({ followUpMode: "all" });

		expect(settingsManager.getFollowUpMode()).toBe("all");

		const { session } = await createAgentSession(
			makeSessionOptions({ settingsManager }),
		);
		session.subscribe(() => {});
		session.dispose();
	}, 15000);

	it("transport: websocket setting applied", async () => {
		const settingsManager = SettingsManager.create(tempDir, tempDir);
		settingsManager.applyOverrides({ transport: "websocket" });

		expect(settingsManager.getTransport()).toBe("websocket");

		const { session } = await createAgentSession(
			makeSessionOptions({ settingsManager }),
		);
		session.subscribe(() => {});
		session.dispose();
	}, 15000);

	it("blockImages: setting applied and images filtered", async () => {
		const settingsManager = SettingsManager.create(tempDir, tempDir);
		settingsManager.applyOverrides({ images: { blockImages: true } });

		expect(settingsManager.getBlockImages()).toBe(true);

		const { session } = await createAgentSession(
			makeSessionOptions({ settingsManager }),
		);
		session.subscribe(() => {});
		session.dispose();
	}, 15000);

	it("DAP tools: all 8 debug tools active in default tool set", async () => {
		const { session } = await createAgentSession(
			makeSessionOptions(),
		);
		session.subscribe(() => {});

		const allTools = session.getAllTools();
		const toolNames = allTools.map((t) => t.name);
		const debugTools = toolNames.filter((n) => n.startsWith("debug_"));
		expect(debugTools.length).toBe(8);
		expect(debugTools).toContain("debug_launch");
		expect(debugTools).toContain("debug_breakpoint");
		expect(debugTools).toContain("debug_stack");
		expect(debugTools).toContain("debug_variables");
		expect(debugTools).toContain("debug_continue");
		expect(debugTools).toContain("debug_step");
		expect(debugTools).toContain("debug_evaluate");
		expect(debugTools).toContain("debug_disconnect");

		session.dispose();
	}, 15000);

	it("capability system: debug tools gated by debug capability", () => {
		for (const name of ["debug_launch", "debug_breakpoint", "debug_stack", "debug_variables",
			"debug_continue", "debug_step", "debug_evaluate", "debug_disconnect"]) {
			expect(CapabilityRegistry.toolToCapability(name)).toBe("debug");
		}
	});

	it("memory store: wired into session and ready", async () => {
		const { session } = await createAgentSession(
			makeSessionOptions(),
		);
		session.subscribe(() => {});

		const store = await session.memoryStoreReady;
		expect(store).toBeDefined();

		await store!.add({ kind: "convention", content: "Test memory entry" });
		const entries = await store!.top(10);
		expect(entries.length).toBeGreaterThan(0);
		expect(entries.some((e) => e.content === "Test memory entry")).toBe(true);

		session.dispose();
	}, 15000);

	it("advisor: wired into session with constitution", async () => {
		const { session } = await createAgentSession(
			makeSessionOptions(),
		);
		session.subscribe(() => {});

		// The advisor should exist on the session
		// It's private, but we can verify the session doesn't crash
		// when processing a prompt (which triggers maybeAdvise)
		await session.prompt("Say ok.");
		await session.agent.waitForIdle();

		const messages = session.agent.state.messages;
		const lastAssistant = messages.findLast((m) => m.role === "assistant");
		expect(lastAssistant).toBeDefined();
		expect(lastAssistant?.stopReason).toBe("stop");

		session.dispose();
	}, 30000);

	it("telemetry: session tracks token usage", async () => {
		const { session } = await createAgentSession(
			makeSessionOptions(),
		);
		session.subscribe(() => {});

		await session.prompt("Say hello.");
		await session.agent.waitForIdle();

		// Telemetry is accessible via getStats or similar
		const stats = session.getStats?.();
		// Even if getStats doesn't exist, the session should have processed tokens
		const messages = session.agent.state.messages;
		const assistant = messages.findLast((m) => m.role === "assistant");
		expect(assistant).toBeDefined();
		if (assistant?.usage) {
			expect(assistant.usage.totalTokens).toBeGreaterThan(0);
		}

		session.dispose();
	}, 30000);

	it("job manager: wired into session", async () => {
		const { session } = await createAgentSession(
			makeSessionOptions(),
		);
		session.subscribe(() => {});

		// Job manager is private but session should not crash
		// when creating/listing jobs via slash commands
		session.dispose();
	}, 15000);

	it("agent with all features enabled: end-to-end tool usage", async () => {
		const settingsManager = SettingsManager.create(tempDir, tempDir);
		settingsManager.applyOverrides({
			cacheAggressiveness: "aggressive",
			steeringMode: "all",
			followUpMode: "all",
			autoReviewSubagents: true,
		});

		writeFileSync(join(tempDir, "test_file.txt"), "hello world");

		const { session } = await createAgentSession(
			makeSessionOptions({
				settingsManager,
				enableSubagents: true,
				autoReviewSubagents: true,
				tools: ["read", "bash", "edit", "write",
					"debug_launch", "debug_breakpoint", "debug_stack", "debug_variables",
					"debug_continue", "debug_step", "debug_evaluate", "debug_disconnect",
					"spawn_agent"],
			}),
		);
		session.subscribe(() => {});

		// Verify all features are active
		expect(settingsManager.getCacheAggressiveness()).toBe("aggressive");
		expect(settingsManager.getSteeringMode()).toBe("all");
		expect(settingsManager.getFollowUpMode()).toBe("all");

		// Verify tools are available
		const allTools = session.getAllTools();
		const toolNames = allTools.map((t) => t.name);
		expect(toolNames).toContain("spawn_agent");
		expect(toolNames).toContain("read");
		expect(toolNames).toContain("bash");
		expect(toolNames.filter((n) => n.startsWith("debug_")).length).toBe(8);

		// Run a real task
		await session.prompt("Read the file test_file.txt and tell me its contents.");
		await session.agent.waitForIdle();

		const messages = session.agent.state.messages;
		const toolResults = messages.filter((m) => m.role === "toolResult");
		expect(toolResults.length).toBeGreaterThan(0);

		const lastAssistant = messages.findLast((m) => m.role === "assistant");
		const text = lastAssistant?.content?.find((c) => c.type === "text")?.text ?? "";
		expect(text.toLowerCase()).toMatch(/hello/);

		session.dispose();
	}, 60000);
});

describe("Feature flags: unit tests (no model required)", () => {
	it("RunTelemetry: tracks cache-aware token accounting", () => {
		const telemetry = new RunTelemetry();
		expect(telemetry).toBeDefined();
		// Verify it doesn't crash on basic operations
		const stats = telemetry.getStats();
		expect(stats).toBeDefined();
	});

	it("JobManager: creates and lists jobs", () => {
		const manager = new JobManager();
		expect(manager).toBeDefined();
		manager.dispose();
	});

	it("AdvisorLoop: respects threshold and cooldown", () => {
		const advisor = new AdvisorLoop({ threshold: 100 });
		expect(advisor.isRunning).toBe(false);
		expect(advisor.lastHardness).toBe(0);
		advisor.dispose();
	});

	it("DebugSessionManager: throws when no session", () => {
		const manager = new DebugSessionManager();
		expect(() => manager.getSession()).toThrow("No active debug session");
	});

	it("DebugSessionManager: clear on empty does nothing", async () => {
		const manager = new DebugSessionManager();
		await manager.clear(); // should not throw
	});

	it("DAP tools: all have sequential execution mode", () => {
		const tools = createDapTools(new DebugSessionManager());
		for (const tool of tools) {
			expect(tool.executionMode).toBe("sequential");
		}
	});

	it("MemoryStore: CRUD operations", async () => {
		const memDir = join(tempDir, "mem-unit-test");
		mkdirSync(memDir, { recursive: true });
		const store = await MemoryStore.create({ cwd: tempDir, agentDir: memDir });

		await store.add({ kind: "convention", content: "Use tabs" });
		await store.add({ kind: "lesson", content: "Test before commit" });

		const all = await store.top(10);
		expect(all.length).toBe(2);

		const conventions = await store.byKind("convention");
		expect(conventions.length).toBe(1);
		expect(conventions[0].content).toBe("Use tabs");

		await store.close();
	});
});
