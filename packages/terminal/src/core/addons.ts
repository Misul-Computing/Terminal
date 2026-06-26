/**
 * Unified addon system.
 *
 * An addon is a directory that can contain any combination of:
 * - skills/ (markdown skill files, same format as the existing skills system)
 * - extension.ts or index.ts (code extension, same format as the existing extension system)
 * - mcp.json (MCP server configuration)
 * - hooks/ (hook scripts)
 *
 * If the directory contains an addon.json manifest, it provides metadata.
 * If not, the directory name is used as the addon name.
 *
 * This is a discovery and routing layer. It scans addon directories for
 * components and routes them to the existing skill/extension/MCP loaders.
 * It does not replace those systems; it unifies their entry point.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import type { ResourceDiagnostic } from "./diagnostics.ts";
import type { PathMetadata } from "./package-manager.ts";
import { createSourceInfo, type SourceInfo } from "./source-info.ts";

/** Addon manifest (addon.json). All fields optional. */
export interface AddonManifest {
	name?: string;
	description?: string;
	version?: string;
	author?: string | { name: string; email?: string };
	repository?: string;
	homepage?: string;
	license?: string;
}

/** MCP server configuration entry (mcp.json). */
export interface McpServerConfig {
	/** Server type. Default: "stdio". */
	type?: "stdio" | "http" | "sse";
	/** Command to run (stdio). */
	command?: string;
	/** Arguments for the command (stdio). */
	args?: string[];
	/** Environment variables (stdio). */
	env?: Record<string, string>;
	/** URL (http/sse). */
	url?: string;
	/** Headers (http/sse). */
	headers?: Record<string, string>;
	/** Working directory (stdio). */
	cwd?: string;
}

/** MCP configuration file (mcp.json). */
export interface McpConfig {
	mcpServers: Record<string, McpServerConfig>;
}

/** A discovered addon with its components. */
export interface Addon {
	/** Addon name (from manifest or directory name). */
	name: string;
	/** Description from manifest, if any. */
	description?: string;
	/** Version from manifest, if any. */
	version?: string;
	/** Absolute path to the addon directory. */
	path: string;
	/** Source info for tracking provenance. */
	sourceInfo: SourceInfo;
	/** Skill directories within this addon (paths to directories containing SKILL.md files). */
	skillPaths: string[];
	/** Extension file path, if the addon has a code extension. */
	extensionPath?: string;
	/** MCP server configurations, if the addon has MCP servers. */
	mcpServers?: Record<string, McpServerConfig>;
	/** Whether the addon has a manifest file. */
	hasManifest: boolean;
}

export interface LoadAddonsResult {
	addons: Addon[];
	diagnostics: ResourceDiagnostic[];
	/** All skill paths from all addons, with metadata. */
	skillPaths: Array<{ path: string; metadata: PathMetadata }>;
	/** All extension paths from all addons, with metadata. */
	extensionPaths: Array<{ path: string; metadata: PathMetadata }>;
	/** All MCP server configs from all addons. */
	mcpServers: Record<string, McpServerConfig>;
}

/**
 * Load an addon from a directory.
 * Scans for addon.json, skills/, extension files, and mcp.json.
 */
export function loadAddon(dir: string, metadata?: PathMetadata): Addon | null {
	if (!existsSync(dir) || !statSync(dir).isDirectory()) return null;

	const manifestPath = join(dir, "addon.json");
	const hasManifest = existsSync(manifestPath);
	let manifest: AddonManifest = {};
	if (hasManifest) {
		try {
			manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
		} catch {
			// Invalid manifest, treat as no manifest
		}
	}

	const name = manifest.name ?? basename(dir);
	const sourceInfo = createSourceInfo(dir, {
		source: metadata?.source ?? "local",
		scope: (metadata?.scope ?? "project") as import("./source-info.ts").SourceScope,
		origin: metadata?.origin ?? "addons",
	});

	// Discover skills
	const skillPaths: string[] = [];
	const skillsDir = join(dir, "skills");
	if (existsSync(skillsDir) && statSync(skillsDir).isDirectory()) {
		skillPaths.push(skillsDir);
	}
	// Also check for a root-level SKILL.md (single-skill addon)
	const rootSkill = join(dir, "SKILL.md");
	if (existsSync(rootSkill)) {
		skillPaths.push(dir);
	}

	// Discover extension
	let extensionPath: string | undefined;
	for (const candidate of ["extension.ts", "index.ts", "extension.js", "index.js"]) {
		const candidatePath = join(dir, candidate);
		if (existsSync(candidatePath)) {
			extensionPath = candidatePath;
			break;
		}
	}

	// Discover MCP servers
	let mcpServers: Record<string, McpServerConfig> | undefined;
	const mcpPath = join(dir, "mcp.json");
	if (existsSync(mcpPath)) {
		try {
			const mcpConfig = JSON.parse(readFileSync(mcpPath, "utf-8")) as McpConfig;
			if (mcpConfig.mcpServers && typeof mcpConfig.mcpServers === "object") {
				mcpServers = mcpConfig.mcpServers;
			}
		} catch {
			// Invalid mcp.json, skip
		}
	}

	// Only return if the addon has at least one component
	if (skillPaths.length === 0 && !extensionPath && !mcpServers) {
		return null;
	}

	return {
		name,
		description: manifest.description,
		version: manifest.version,
		path: resolve(dir),
		sourceInfo,
		skillPaths,
		extensionPath,
		mcpServers,
		hasManifest,
	};
}

/**
 * Load all addons from a list of directories.
 * Each directory can be an addon itself or a parent containing addon subdirectories.
 */
export function loadAddons(
	dirs: Array<{ path: string; metadata: PathMetadata }>,
): LoadAddonsResult {
	const addons: Addon[] = [];
	const diagnostics: ResourceDiagnostic[] = [];
	const skillPaths: Array<{ path: string; metadata: PathMetadata }> = [];
	const extensionPaths: Array<{ path: string; metadata: PathMetadata }> = [];
	const mcpServers: Record<string, McpServerConfig> = {};

	for (const { path: dir, metadata } of dirs) {
		if (!existsSync(dir)) {
			diagnostics.push({ type: "error", message: `Addon path does not exist: ${dir}`, path: dir });
			continue;
		}

		// Try loading as a direct addon first
		const directAddon = loadAddon(dir, metadata);
		if (directAddon) {
			addons.push(directAddon);
			collectAddonComponents(directAddon, metadata, skillPaths, extensionPaths, mcpServers);
			continue;
		}

		// Try scanning subdirectories
		try {
			const entries = readdirSync(dir);
			let foundAny = false;
			for (const entry of entries) {
				const subDir = join(dir, entry);
				if (!existsSync(subDir) || !statSync(subDir).isDirectory()) continue;
				const addon = loadAddon(subDir, metadata);
				if (addon) {
					addons.push(addon);
					collectAddonComponents(addon, metadata, skillPaths, extensionPaths, mcpServers);
					foundAny = true;
				}
			}
			if (!foundAny && entries.length > 0) {
				// Directory exists but no addons found, that's fine
			}
		} catch (error) {
			diagnostics.push({
				type: "error",
				message: `Failed to scan addon directory ${dir}: ${error}`,
				path: dir,
			});
		}
	}

	return { addons, diagnostics, skillPaths, extensionPaths, mcpServers };
}

function collectAddonComponents(
	addon: Addon,
	metadata: PathMetadata,
	skillPaths: Array<{ path: string; metadata: PathMetadata }>,
	extensionPaths: Array<{ path: string; metadata: PathMetadata }>,
	mcpServers: Record<string, McpServerConfig>,
): void {
	for (const skillPath of addon.skillPaths) {
		skillPaths.push({ path: skillPath, metadata });
	}
	if (addon.extensionPath) {
		extensionPaths.push({ path: addon.extensionPath, metadata });
	}
	if (addon.mcpServers) {
		for (const [name, config] of Object.entries(addon.mcpServers)) {
			mcpServers[`${addon.name}:${name}`] = config;
		}
	}
}

/**
 * Default addon directories to scan.
 * - ~/.misul/agent/addons/ (global)
 * - .misul/addons/ (project)
 */
export function getGlobalAddonsDir(agentDir: string): string {
	return join(agentDir, "addons");
}

export function getProjectAddonsDir(cwd: string): string {
	return join(cwd, ".misul", "addons");
}
