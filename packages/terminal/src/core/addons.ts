import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import type { ResourceDiagnostic } from "./diagnostics.ts";
import type { PathMetadata } from "./package-manager.ts";
import { createSourceInfo, type SourceInfo } from "./source-info.ts";

export interface AddonManifest {
	name?: string;
	description?: string;
	version?: string;
	author?: string | { name: string; email?: string };
	repository?: string;
	homepage?: string;
	license?: string;
	components?: { skills?: boolean; extension?: boolean; mcp?: boolean; acp?: boolean };
}

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

export interface Addon {
	name: string;
	description?: string;
	version?: string;
	path: string;
	sourceInfo: SourceInfo;
	skillPaths: string[];
	extensionPath?: string;
	mcpServers?: Record<string, McpServerConfig>;
	acpAgents?: Record<string, AcpAgentConfig>;
	hasManifest: boolean;
}

export interface LoadAddonsResult {
	addons: Addon[];
	diagnostics: ResourceDiagnostic[];
	skillPaths: Array<{ path: string; metadata: PathMetadata }>;
	extensionPaths: Array<{ path: string; metadata: PathMetadata }>;
	mcpServers: Record<string, McpServerConfig>;
	acpAgents: Record<string, AcpAgentConfig>;
}

function loadJson<T>(path: string): T | undefined {
	try { return JSON.parse(readFileSync(path, "utf-8")) as T; } catch { return undefined; }
}

export function loadAddon(dir: string, metadata?: PathMetadata): Addon | null {
	if (!existsSync(dir) || !statSync(dir).isDirectory()) return null;

	const manifestPath = join(dir, "addon.json");
	const hasManifest = existsSync(manifestPath);
	const manifest: AddonManifest = hasManifest ? (loadJson<AddonManifest>(manifestPath) ?? {}) : {};

	const name = manifest.name ?? basename(dir);
	const sourceInfo = createSourceInfo(dir, {
		source: metadata?.source ?? "local",
		scope: (metadata?.scope ?? "project") as import("./source-info.ts").SourceScope,
		origin: metadata?.origin ?? "addons",
	});

	const skillPaths: string[] = [];
	const skillsDir = join(dir, "skills");
	if (existsSync(skillsDir) && statSync(skillsDir).isDirectory()) skillPaths.push(skillsDir);
	if (existsSync(join(dir, "SKILL.md"))) skillPaths.push(dir);

	let extensionPath: string | undefined;
	for (const candidate of ["extension.ts", "index.ts", "extension.js", "index.js"]) {
		const candidatePath = join(dir, candidate);
		if (existsSync(candidatePath)) { extensionPath = candidatePath; break; }
	}

	const mcpPath = join(dir, "mcp.json");
	const mcpServers = existsSync(mcpPath) ? loadJson<McpConfig>(mcpPath)?.mcpServers : undefined;

	const acpPath = join(dir, "acp.json");
	const acpAgents = existsSync(acpPath) ? loadJson<AcpConfig>(acpPath)?.acpAgents : undefined;

	if (skillPaths.length === 0 && !extensionPath && !mcpServers && !acpAgents) return null;

	return { name, description: manifest.description, version: manifest.version, path: resolve(dir), sourceInfo, skillPaths, extensionPath, mcpServers, acpAgents, hasManifest };
}

export function loadAddons(dirs: Array<{ path: string; metadata: PathMetadata }>): LoadAddonsResult {
	const addons: Addon[] = [];
	const diagnostics: ResourceDiagnostic[] = [];
	const skillPaths: Array<{ path: string; metadata: PathMetadata }> = [];
	const extensionPaths: Array<{ path: string; metadata: PathMetadata }> = [];
	const mcpServers: Record<string, McpServerConfig> = {};
	const acpAgents: Record<string, AcpAgentConfig> = {};

	const collect = (addon: Addon, metadata: PathMetadata) => {
		for (const skillPath of addon.skillPaths) skillPaths.push({ path: skillPath, metadata });
		if (addon.extensionPath) extensionPaths.push({ path: addon.extensionPath, metadata });
		if (addon.mcpServers) for (const [n, c] of Object.entries(addon.mcpServers)) mcpServers[`${addon.name}:${n}`] = c;
		if (addon.acpAgents) for (const [n, c] of Object.entries(addon.acpAgents)) acpAgents[`${addon.name}:${n}`] = c;
	};

	for (const { path: dir, metadata } of dirs) {
		if (!existsSync(dir)) { diagnostics.push({ type: "error", message: `Addon path does not exist: ${dir}`, path: dir }); continue; }
		const direct = loadAddon(dir, metadata);
		if (direct) { addons.push(direct); collect(direct, metadata); continue; }
		try {
			for (const entry of readdirSync(dir)) {
				const subDir = join(dir, entry);
				if (!existsSync(subDir) || !statSync(subDir).isDirectory()) continue;
				const addon = loadAddon(subDir, metadata);
				if (addon) { addons.push(addon); collect(addon, metadata); }
			}
		} catch (error) {
			diagnostics.push({ type: "error", message: `Failed to scan addon directory ${dir}: ${error}`, path: dir });
		}
	}

	return { addons, diagnostics, skillPaths, extensionPaths, mcpServers, acpAgents };
}

export function getGlobalAddonsDir(agentDir: string): string { return join(agentDir, "addons"); }
export function getProjectAddonsDir(cwd: string): string { return join(cwd, ".misul", "addons"); }
