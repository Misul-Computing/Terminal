/**
 * ACP (Agent Client Protocol) agent configuration and discovery.
 *
 * ACP agents are a standalone extension mechanism — not bundled into an
 * "addon" package. They are discovered from acp.json files in the global
 * agent directory (~/.misul/agent/acp.json) and project directory
 * (.misul/acp.json).
 */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ResourceDiagnostic } from "./diagnostics.ts";
import type { PathMetadata } from "./package-manager.ts";

export interface AcpAgentConfig {
	type?: "stdio";
	command?: string;
	args?: string[];
	env?: Record<string, string>;
	cwd?: string;
	description?: string;
}

export interface AcpConfig {
	acpAgents: Record<string, AcpAgentConfig>;
}

function loadJson<T>(path: string): T | undefined {
	try {
		return JSON.parse(readFileSync(path, "utf-8")) as T;
	} catch {
		return undefined;
	}
}

export interface LoadAcpResult {
	acpAgents: Record<string, AcpAgentConfig>;
	diagnostics: ResourceDiagnostic[];
}

/**
 * Load ACP agent configs from global and project acp.json files.
 *
 * Global agents are loaded first; project agents are merged on top.
 * If both define an agent with the same name, the project one wins.
 */
export function loadAcpAgentsConfigs(
	dirs: Array<{ path: string; metadata: PathMetadata }>,
): LoadAcpResult {
	const acpAgents: Record<string, AcpAgentConfig> = {};
	const diagnostics: ResourceDiagnostic[] = [];

	for (const { path: dir } of dirs) {
		if (!existsSync(dir)) continue;
		const acpPath = join(dir, "acp.json");
		if (!existsSync(acpPath)) continue;
		const config = loadJson<AcpConfig>(acpPath);
		if (!config?.acpAgents) continue;
		for (const [name, agentConfig] of Object.entries(config.acpAgents)) {
			acpAgents[name] = agentConfig;
		}
	}

	return { acpAgents, diagnostics };
}

export function getGlobalAcpConfigPath(agentDir: string): string {
	return join(agentDir, "acp.json");
}

export function getProjectAcpConfigPath(cwd: string): string {
	return join(cwd, ".misul", "acp.json");
}

/**
 * Resolve a CLI-specified acp.json path to an absolute path.
 */
export function resolveAcpConfigPath(p: string, cwd: string): string {
	return resolve(cwd, p);
}
