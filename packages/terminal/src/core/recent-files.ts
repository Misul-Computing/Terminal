/**
 * Session-start repo orientation: the files the user has touched most recently —
 * uncommitted working-tree changes first (the active task), then recent git history.
 *
 * SWE-Explore found context efficiency is the #1 predictor of resolve rate, and
 * recently-edited files are a strong prior for where the relevant code lives. Injecting
 * this list at session start lets the model route exploration there instead of grepping
 * from scratch. Cheap (git only, no index, no new dependency) and degrades to nothing
 * outside a git repo.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Parse `git log --name-only --pretty=format:` output into the first `limit` unique file paths. */
export function parseRecentFiles(gitLogOutput: string, limit: number): string[] {
	const seen: string[] = [];
	const set = new Set<string>();
	for (const raw of gitLogOutput.split("\n")) {
		const file = raw.trim();
		if (!file || set.has(file)) continue;
		set.add(file);
		seen.push(file);
		if (seen.length >= limit) break;
	}
	return seen;
}

/**
 * Recently-edited files from git history, most-recent first. Returns [] outside a git repo,
 * if git is missing, on timeout, or on any error — never throws.
 */
export async function getRecentlyEditedFiles(cwd: string, limit = 15): Promise<string[]> {
	try {
		const { stdout } = await execFileAsync("git", ["log", "--name-only", "--pretty=format:", "-n", "40"], {
			cwd,
			timeout: 2000,
			maxBuffer: 1024 * 1024,
			windowsHide: true,
		});
		return parseRecentFiles(stdout, limit);
	} catch {
		return [];
	}
}

/** Parse `git status --porcelain` output into changed file paths (renames -> the new path). */
export function parseGitStatus(output: string): string[] {
	const files: string[] = [];
	for (const line of output.split("\n")) {
		if (line.length < 4) continue;
		let path = line.slice(3).trim(); // strip the 2-char XY status + space
		const arrow = path.indexOf(" -> ");
		if (arrow !== -1) path = path.slice(arrow + 4); // "old -> new" rename: keep the new path
		if (path.startsWith('"') && path.endsWith('"')) path = path.slice(1, -1); // porcelain quotes special chars
		if (path) files.push(path);
	}
	return files;
}

/** Uncommitted working-tree changes (staged + unstaged). [] outside a git repo / on error. */
export async function getUncommittedFiles(cwd: string): Promise<string[]> {
	try {
		const { stdout } = await execFileAsync("git", ["status", "--porcelain"], {
			cwd,
			timeout: 2000,
			maxBuffer: 1024 * 1024,
			windowsHide: true,
		});
		return parseGitStatus(stdout);
	} catch {
		return [];
	}
}

/**
 * Repo orientation file list: uncommitted working-tree changes (the active task) first, then
 * recent git history, deduped and capped at `limit`. [] outside a git repo. Never throws.
 */
export async function getRepoOrientationFiles(cwd: string, limit = 15): Promise<string[]> {
	const [uncommitted, committed] = await Promise.all([getUncommittedFiles(cwd), getRecentlyEditedFiles(cwd, limit)]);
	const seen = new Set<string>();
	const merged: string[] = [];
	for (const file of [...uncommitted, ...committed]) {
		if (seen.has(file)) continue;
		seen.add(file);
		merged.push(file);
		if (merged.length >= limit) break;
	}
	return merged;
}
