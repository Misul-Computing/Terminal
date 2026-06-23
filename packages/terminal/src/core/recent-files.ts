/**
 * Session-start repo orientation: the files edited most recently (from git history).
 *
 * SWE-Explore found context efficiency is the #1 predictor of resolve rate, and
 * recently-edited files are a strong prior for where the relevant code lives. Injecting
 * this list at session start lets the model route exploration there instead of grepping
 * from scratch. Cheap (one git call, no index, no new dependency) and degrades to nothing
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
