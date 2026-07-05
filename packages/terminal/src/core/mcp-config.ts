/**
 * MCP (Model Context Protocol) server configuration and discovery.
 *
 * MCP servers are a standalone extension mechanism — not bundled into an
 * "addon" package. They are discovered from mcp.json files in the global
 * agent directory (~/.misul/agent/mcp.json) and project directory
 * (.misul/mcp.json).
 */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ResourceDiagnostic } from "./diagnostics.ts";
import type { PathMetadata } from "./package-manager.ts";

export interface McpServerConfig {
	type?: "stdio" | "http" | "sse";
	command?: string;
	args?: string[];
	env?: Record<string, string>;
	url?: string;
	headers?: Record<string, string>;
	cwd?: string;
}

export interface McpConfig {
	mcpServers: Record<string, McpServerConfig>;
}

function loadJson<T>(path: string): T | undefined {
	try {
		return JSON.parse(readFileSync(path, "utf-8")) as T;
	} catch {
		return undefined;
	}
}

export interface LoadMcpResult {
	mcpServers: Record<string, McpServerConfig>;
	diagnostics: ResourceDiagnostic[];
}

/**
 * Load MCP server configs from global and project mcp.json files.
 *
 * Global servers are loaded first; project servers are merged on top.
 * If both define a server with the same name, the project one wins.
 */
export function loadMcpServers(
	dirs: Array<{ path: string; metadata: PathMetadata }>,
): LoadMcpResult {
	const mcpServers: Record<string, McpServerConfig> = {};
	const diagnostics: ResourceDiagnostic[] = [];

	for (const { path: dir } of dirs) {
		if (!existsSync(dir)) continue;
		const mcpPath = join(dir, "mcp.json");
		if (!existsSync(mcpPath)) continue;
		const config = loadJson<McpConfig>(mcpPath);
		if (!config?.mcpServers) continue;
		for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
			mcpServers[name] = serverConfig;
		}
	}

	return { mcpServers, diagnostics };
}

export function getGlobalMcpConfigPath(agentDir: string): string {
	return join(agentDir, "mcp.json");
}

export function getProjectMcpConfigPath(cwd: string): string {
	return join(cwd, ".misul", "mcp.json");
}

/**
 * Resolve a CLI-specified mcp.json path to an absolute path.
 */
export function resolveMcpConfigPath(p: string, cwd: string): string {
	return resolve(cwd, p);
}
