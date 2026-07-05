/**
 * Resource change checker for live reload.
 *
 * Instead of running constant file watchers, this checks for changes on
 * demand - called by the agent loop after tool calls complete, before the
 * next LLM turn. No background process, no file descriptors held.
 *
 * Records directory modification times (mtime) for each resource directory.
 * When checkForChanges() is called, compares current mtimes to the last
 * recorded values. If any changed, returns the scope of the change so the
 * caller can do a granular reload.
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** Resource directories to check. */
export interface ResourceDirs {
	globalSkills?: string[];
	projectSkills?: string[];
	globalExtensions?: string[];
	projectExtensions?: string[];
	globalPrompts?: string[];
	projectPrompts?: string[];
	globalMcpConfig?: string;
	projectMcpConfig?: string;
	globalAcpConfig?: string;
	projectAcpConfig?: string;
}

/** What changed, for granular reload. */
export type ReloadScope = "skills" | "extensions" | "prompts" | "themes" | "mcp" | "acp" | "all";

/**
 * On-demand change checker for resource directories.
 *
 * Usage:
 *   const checker = new ResourceChangeChecker();
 *   checker.init(dirs);
 *   // ... after a tool call ...
 *   const scope = checker.checkForChanges();
 *   if (scope) await session.liveReload();
 */
export class ResourceChangeChecker {
	private _dirMtimes = new Map<string, number>();
	private _dirs: Array<{ path: string; scope: ReloadScope }> = [];

	/**
	 * Initialize with the directories to monitor.
	 * Records current mtimes so the first checkForChanges() doesn't fire.
	 */
	init(dirs: ResourceDirs): void {
		this._dirs = [];
		this._dirMtimes.clear();

		const add = (dir: string | undefined, scope: ReloadScope): void => {
			if (!dir) return;
			this._dirs.push({ path: dir, scope });
		};

		for (const d of dirs.globalSkills ?? []) add(d, "skills");
		for (const d of dirs.projectSkills ?? []) add(d, "skills");
		for (const d of dirs.globalExtensions ?? []) add(d, "extensions");
		for (const d of dirs.projectExtensions ?? []) add(d, "extensions");
		for (const d of dirs.globalPrompts ?? []) add(d, "prompts");
		for (const d of dirs.projectPrompts ?? []) add(d, "prompts");
		add(dirs.globalMcpConfig, "mcp");
		add(dirs.projectMcpConfig, "mcp");
		add(dirs.globalAcpConfig, "acp");
		add(dirs.projectAcpConfig, "acp");

		this._recordMtimes();
	}

	/**
	 * Check if any monitored directory has changed since the last check.
	 * Returns the scope of the change, or undefined if nothing changed.
	 *
	 * This is a cheap operation: a few statSync calls on directory entries.
	 * No file watchers, no background process, no file descriptors held.
	 */
	checkForChanges(): ReloadScope | undefined {
		const changedScopes = new Set<ReloadScope>();

		for (const { path: dir, scope } of this._dirs) {
			if (!existsSync(dir)) continue;
			const currentMtime = this._getDirMtime(dir);
			const lastMtime = this._dirMtimes.get(dir);
			if (lastMtime !== currentMtime) {
				changedScopes.add(scope);
				this._dirMtimes.set(dir, currentMtime);
			}
		}

		if (changedScopes.size === 0) return undefined;
		if (changedScopes.has("all")) return "all";
		if (changedScopes.size > 1) return "all";
		return [...changedScopes][0];
	}

	/**
	 * Get the most recent mtime among a directory and its immediate children.
	 * This catches new files (new entry in the directory) and changed files
	 * (child mtime updated) without deep recursion.
	 */
	private _getDirMtime(dir: string): number {
		try {
			let max = statSync(dir).mtimeMs;
			for (const entry of readdirSync(dir)) {
				try {
					const mtime = statSync(join(dir, entry)).mtimeMs;
					if (mtime > max) max = mtime;
				} catch {
					// Skip entries that can't be stat'd
				}
			}
			return max;
		} catch {
			return -1;
		}
	}

	private _recordMtimes(): void {
		for (const { path: dir } of this._dirs) {
			if (existsSync(dir)) {
				this._dirMtimes.set(dir, this._getDirMtime(dir));
			}
		}
	}
}
