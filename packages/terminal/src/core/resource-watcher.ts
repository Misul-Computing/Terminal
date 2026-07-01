/**
 * Resource file watcher for live reload.
 *
 * Watches skill, extension, prompt, theme, and addon directories for changes.
 * When files change, triggers a debounced reload callback. The callback can
 * do a granular reload (e.g. only rebuild the skills block) to preserve the
 * prompt cache prefix.
 */

import { type FSWatcher, watch } from "node:fs";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { closeWatcher, watchWithErrorHandler } from "../utils/fs-watch.ts";

/** Directories to watch for live reload. */
export interface WatchDirs {
	/** Global skill directories */
	globalSkills?: string[];
	/** Project skill directories */
	projectSkills?: string[];
	/** Global extension directories */
	globalExtensions?: string[];
	/** Project extension directories */
	projectExtensions?: string[];
	/** Global prompt template directories */
	globalPrompts?: string[];
	/** Project prompt template directories */
	projectPrompts?: string[];
	/** Global addon directory */
	globalAddons?: string;
	/** Project addon directory */
	projectAddons?: string;
	/** Additional CLI-specified paths */
	cliPaths?: string[];
}

/** What changed, for granular reload. */
export type ReloadScope = "skills" | "extensions" | "prompts" | "themes" | "addons" | "all";

/** Callback for reload. */
export type ReloadCallback = (scope: ReloadScope) => void;

const DEBOUNCE_MS = 300;

/**
 * Resource watcher that monitors directories and triggers debounced reloads.
 *
 * Usage:
 *   const watcher = new ResourceWatcher();
 *   watcher.start({ globalSkills: [...], projectSkills: [...] }, (scope) => {
 *     // Do granular reload based on scope
 *   });
 *   // Later:
 *   watcher.stop();
 */
export class ResourceWatcher {
	private _watchers: FSWatcher[] = [];
	private _debounceTimer: ReturnType<typeof setTimeout> | undefined;
	private _pendingScope: Set<ReloadScope> = new Set();
	private _callback: ReloadCallback | undefined;
	private _stopped = false;

	/**
	 * Start watching the given directories.
	 * @param dirs Directories to watch
	 * @param callback Called with the scope of changes (debounced)
	 */
	start(dirs: WatchDirs, callback: ReloadCallback): void {
		this.stop();
		this._stopped = false;
		this._callback = callback;

		const watchDir = (dir: string, scope: ReloadScope): void => {
			if (!dir || !existsSync(dir)) return;
			try {
				if (!statSync(dir).isDirectory()) return;
			} catch {
				return;
			}

			const watcher = watchWithErrorHandler(
				dir,
				(_eventType, _filename) => {
					this._scheduleReload(scope);
				},
				() => {
					// On error, the watcher is already closed
				},
			);
			if (watcher) {
				this._watchers.push(watcher);
			}
		};

		// Watch skill directories
		for (const dir of dirs.globalSkills ?? []) {
			watchDir(dir, "skills");
		}
		for (const dir of dirs.projectSkills ?? []) {
			watchDir(dir, "skills");
		}

		// Watch extension directories
		for (const dir of dirs.globalExtensions ?? []) {
			watchDir(dir, "extensions");
		}
		for (const dir of dirs.projectExtensions ?? []) {
			watchDir(dir, "extensions");
		}

		// Watch prompt directories
		for (const dir of dirs.globalPrompts ?? []) {
			watchDir(dir, "prompts");
		}
		for (const dir of dirs.projectPrompts ?? []) {
			watchDir(dir, "prompts");
		}

		// Watch addon directories
		if (dirs.globalAddons) {
			watchDir(dirs.globalAddons, "addons");
		}
		if (dirs.projectAddons) {
			watchDir(dirs.projectAddons, "addons");
		}

		// Watch CLI-specified paths
		for (const p of dirs.cliPaths ?? []) {
			watchDir(p, "all");
		}
	}

	/** Stop all watchers and clear pending timers. */
	stop(): void {
		this._stopped = true;
		if (this._debounceTimer) {
			clearTimeout(this._debounceTimer);
			this._debounceTimer = undefined;
		}
		this._pendingScope.clear();
		for (const watcher of this._watchers) {
			closeWatcher(watcher);
		}
		this._watchers = [];
		this._callback = undefined;
	}

	/** Whether the watcher is currently active. */
	get isWatching(): boolean {
		return this._watchers.length > 0 && !this._stopped;
	}

	private _scheduleReload(scope: ReloadScope): void {
		this._pendingScope.add(scope);

		if (this._debounceTimer) {
			clearTimeout(this._debounceTimer);
		}

		this._debounceTimer = setTimeout(() => {
			this._debounceTimer = undefined;
			if (this._stopped || !this._callback) return;

			// Determine the broadest scope
			const scopes = [...this._pendingScope];
			this._pendingScope.clear();

			if (scopes.includes("all")) {
				this._callback("all");
				return;
			}

			// If multiple scopes changed, reload all
			if (scopes.length > 1) {
				this._callback("all");
				return;
			}

			this._callback(scopes[0]);
		}, DEBOUNCE_MS);
	}
}
