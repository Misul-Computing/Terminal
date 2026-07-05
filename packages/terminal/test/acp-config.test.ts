import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadAcpAgentsConfigs } from "../src/core/acp-config.ts";
import { loadMcpServers } from "../src/core/mcp-config.ts";

describe("ACP config loading", () => {
	let tmpDir: string;

	beforeEach(() => { tmpDir = mkdtempSync(join(tmpdir(), "misul-acp-config-")); });
	afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

	it("discovers acp.json in a directory", () => {
		writeFileSync(join(tmpDir, "acp.json"), JSON.stringify({ acpAgents: { "my-agent": { command: "node", args: ["agent.js"], description: "A test ACP agent" } } }));

		const result = loadAcpAgentsConfigs([{ path: tmpDir, metadata: { source: "local", scope: "project", origin: "top-level" } }]);
		expect(result.acpAgents["my-agent"].command).toBe("node");
		expect(result.acpAgents["my-agent"].description).toBe("A test ACP agent");
	});

	it("merges ACP agents from multiple directories", () => {
		const dir1 = join(tmpDir, "global");
		const dir2 = join(tmpDir, "project");
		mkdirSync(dir1, { recursive: true });
		mkdirSync(dir2, { recursive: true });
		writeFileSync(join(dir1, "acp.json"), JSON.stringify({ acpAgents: { agent1: { command: "echo" } } }));
		writeFileSync(join(dir2, "acp.json"), JSON.stringify({ acpAgents: { agent2: { command: "cat" } } }));

		const result = loadAcpAgentsConfigs([
			{ path: dir1, metadata: { source: "global", scope: "user", origin: "top-level" } },
			{ path: dir2, metadata: { source: "project", scope: "project", origin: "top-level" } },
		]);
		expect(result.acpAgents["agent1"].command).toBe("echo");
		expect(result.acpAgents["agent2"].command).toBe("cat");
	});

	it("project overrides global for same-named agent", () => {
		const dir1 = join(tmpDir, "global");
		const dir2 = join(tmpDir, "project");
		mkdirSync(dir1, { recursive: true });
		mkdirSync(dir2, { recursive: true });
		writeFileSync(join(dir1, "acp.json"), JSON.stringify({ acpAgents: { shared: { command: "global-cmd" } } }));
		writeFileSync(join(dir2, "acp.json"), JSON.stringify({ acpAgents: { shared: { command: "project-cmd" } } }));

		const result = loadAcpAgentsConfigs([
			{ path: dir1, metadata: { source: "global", scope: "user", origin: "top-level" } },
			{ path: dir2, metadata: { source: "project", scope: "project", origin: "top-level" } },
		]);
		expect(result.acpAgents["shared"].command).toBe("project-cmd");
	});

	it("returns empty when no acp.json exists", () => {
		const result = loadAcpAgentsConfigs([{ path: tmpDir, metadata: { source: "local", scope: "project", origin: "top-level" } }]);
		expect(Object.keys(result.acpAgents)).toHaveLength(0);
	});

	it("handles invalid acp.json gracefully", () => {
		writeFileSync(join(tmpDir, "acp.json"), "{ invalid json }");
		const result = loadAcpAgentsConfigs([{ path: tmpDir, metadata: { source: "local", scope: "project", origin: "top-level" } }]);
		expect(Object.keys(result.acpAgents)).toHaveLength(0);
	});
});

describe("MCP config loading", () => {
	let tmpDir: string;

	beforeEach(() => { tmpDir = mkdtempSync(join(tmpdir(), "misul-mcp-config-")); });
	afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

	it("discovers mcp.json in a directory", () => {
		writeFileSync(join(tmpDir, "mcp.json"), JSON.stringify({ mcpServers: { "my-mcp": { command: "node", args: ["mcp.js"] } } }));

		const result = loadMcpServers([{ path: tmpDir, metadata: { source: "local", scope: "project", origin: "top-level" } }]);
		expect(result.mcpServers["my-mcp"].command).toBe("node");
	});

	it("merges MCP servers from multiple directories", () => {
		const dir1 = join(tmpDir, "global");
		const dir2 = join(tmpDir, "project");
		mkdirSync(dir1, { recursive: true });
		mkdirSync(dir2, { recursive: true });
		writeFileSync(join(dir1, "mcp.json"), JSON.stringify({ mcpServers: { server1: { command: "echo" } } }));
		writeFileSync(join(dir2, "mcp.json"), JSON.stringify({ mcpServers: { server2: { command: "cat" } } }));

		const result = loadMcpServers([
			{ path: dir1, metadata: { source: "global", scope: "user", origin: "top-level" } },
			{ path: dir2, metadata: { source: "project", scope: "project", origin: "top-level" } },
		]);
		expect(result.mcpServers["server1"].command).toBe("echo");
		expect(result.mcpServers["server2"].command).toBe("cat");
	});

	it("returns empty when no mcp.json exists", () => {
		const result = loadMcpServers([{ path: tmpDir, metadata: { source: "local", scope: "project", origin: "top-level" } }]);
		expect(Object.keys(result.mcpServers)).toHaveLength(0);
	});

	it("handles invalid mcp.json gracefully", () => {
		writeFileSync(join(tmpDir, "mcp.json"), "{ invalid json }");
		const result = loadMcpServers([{ path: tmpDir, metadata: { source: "local", scope: "project", origin: "top-level" } }]);
		expect(Object.keys(result.mcpServers)).toHaveLength(0);
	});
});
