import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadAddon, loadAddons } from "../src/core/addons.ts";

describe("addon ACP discovery", () => {
	let tmpDir: string;

	beforeEach(() => { tmpDir = mkdtempSync(join(tmpdir(), "misul-acp-test-")); });
	afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

	it("discovers acp.json in an addon directory", () => {
		const addonDir = join(tmpDir, "my-acp-addon");
		mkdirSync(addonDir);
		writeFileSync(join(addonDir, "addon.json"), JSON.stringify({ name: "my-acp-addon", description: "An ACP agent addon", version: "1.0.0" }));
		writeFileSync(join(addonDir, "acp.json"), JSON.stringify({ acpAgents: { "my-agent": { command: "node", args: ["agent.js"], description: "A test ACP agent" } } }));

		const addon = loadAddon(addonDir);
		expect(addon).not.toBeNull();
		expect(addon!.name).toBe("my-acp-addon");
		expect(addon!.acpAgents!["my-agent"].command).toBe("node");
		expect(addon!.acpAgents!["my-agent"].description).toBe("A test ACP agent");
	});

	it("discovers ACP agents alongside MCP servers and skills", () => {
		const addonDir = join(tmpDir, "mixed-addon");
		mkdirSync(addonDir);
		mkdirSync(join(addonDir, "skills"));
		writeFileSync(join(addonDir, "skills", "SKILL.md"), "---\nname: test-skill\ndescription: A test skill\n---\n# Test Skill\n");
		writeFileSync(join(addonDir, "mcp.json"), JSON.stringify({ mcpServers: { "test-mcp": { command: "node", args: ["mcp.js"] } } }));
		writeFileSync(join(addonDir, "acp.json"), JSON.stringify({ acpAgents: { "test-acp": { command: "node", args: ["acp.js"] } } }));

		const addon = loadAddon(addonDir);
		expect(addon).not.toBeNull();
		expect(addon!.skillPaths.length).toBe(1);
		expect(addon!.mcpServers!["test-mcp"]).toBeDefined();
		expect(addon!.acpAgents!["test-acp"]).toBeDefined();
	});

	it("returns null for a directory with no addon components", () => {
		const addonDir = join(tmpDir, "empty-addon");
		mkdirSync(addonDir);
		writeFileSync(join(addonDir, "README.md"), "# Not an addon");
		expect(loadAddon(addonDir)).toBeNull();
	});

	it("loadAddons collects ACP agents with addon name prefix", () => {
		const addonDir = join(tmpDir, "prefixed-addon");
		mkdirSync(addonDir);
		writeFileSync(join(addonDir, "addon.json"), JSON.stringify({ name: "prefixed-addon" }));
		writeFileSync(join(addonDir, "acp.json"), JSON.stringify({ acpAgents: { agent1: { command: "echo" }, agent2: { command: "cat" } } }));

		const result = loadAddons([{ path: tmpDir, metadata: { source: "local", scope: "project", origin: "addons" } }]);
		expect(result.acpAgents["prefixed-addon:agent1"].command).toBe("echo");
		expect(result.acpAgents["prefixed-addon:agent2"].command).toBe("cat");
	});

	it("handles invalid acp.json gracefully", () => {
		const addonDir = join(tmpDir, "bad-acp-addon");
		mkdirSync(addonDir);
		writeFileSync(join(addonDir, "addon.json"), JSON.stringify({ name: "bad-acp-addon" }));
		writeFileSync(join(addonDir, "acp.json"), "{ invalid json }");
		mkdirSync(join(addonDir, "skills"));
		writeFileSync(join(addonDir, "skills", "SKILL.md"), "---\nname: test\ndescription: test\n---\n# Test\n");

		const addon = loadAddon(addonDir);
		expect(addon).not.toBeNull();
		expect(addon!.acpAgents).toBeUndefined();
		expect(addon!.skillPaths.length).toBe(1);
	});
});
