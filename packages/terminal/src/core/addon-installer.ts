/**
 * Addon installation from git, npm, or local sources.
 *
 * This is a self-contained installer. It does not depend on settings or the
 * package manager. Given a source string and a target directory, it installs
 * the addon into targetDir/<addon-name> and verifies the result contains at
 * least one addon component.
 */

import { existsSync, mkdirSync, rmSync, symlinkSync, copyFileSync, readdirSync, statSync } from "node:fs";
import { join, basename, resolve } from "node:path";
import { spawnProcess } from "../utils/child-process.ts";
import { parseGitUrl, type GitSource } from "../utils/git.ts";
import { isLocalPath, resolvePath } from "../utils/paths.ts";
import { loadAddon } from "./addons.ts";

export interface InstallResult {
	success: boolean;
	path: string;
	name: string;
	error?: string;
}

/**
 * Install an addon from a git, npm, or local source into targetDir/<addon-name>.
 *
 * Source formats:
 * - git:<url>                 -> git clone --depth 1
 * - git@host:path             -> git clone --depth 1
 * - github.com/user/repo      -> git clone --depth 1
 * - https://.../user/repo     -> git clone --depth 1
 * - npm:<spec>                -> npm pack, then extract tarball
 * - <local path>              -> symlink (or copy on Windows)
 */
export async function installAddon(source: string, targetDir: string): Promise<InstallResult> {
	try {
		mkdirSync(targetDir, { recursive: true });

		const trimmed = source.trim();

		if (trimmed.startsWith("npm:")) {
			return await installFromNpm(trimmed.slice(4).trim(), targetDir);
		}

		// git: prefix, SSH git URLs, and GitHub URLs all go through parseGitUrl.
		const gitSource = parseGitUrl(trimmed);
		if (gitSource) {
			return await installFromGit(gitSource, targetDir);
		}
		if (/^github\.com\//i.test(trimmed)) {
			const gs = parseGitUrl(`https://${trimmed}`);
			if (gs) {
				return await installFromGit(gs, targetDir);
			}
		}

		// Local path: must exist on disk.
		if (isLocalPath(trimmed)) {
			const localPath = resolvePath(trimmed);
			if (existsSync(localPath) && statSync(localPath).isDirectory()) {
				return await installFromLocal(localPath, targetDir);
			}
		}

		// Fallback: anything else that looks like a URL is treated as git.
		if (/^(https?|ssh|git):\/\//i.test(trimmed)) {
			const gs = parseGitUrl(trimmed);
			if (gs) {
				return await installFromGit(gs, targetDir);
			}
		}

		return { success: false, path: "", name: "", error: `Unrecognized addon source: ${source}` };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { success: false, path: "", name: "", error: message };
	}
}

async function installFromGit(gs: GitSource, targetDir: string): Promise<InstallResult> {
	const name = basename(gs.path) || gs.path;
	const dest = join(targetDir, name);
	removePath(dest);

	const args = ["clone", "--depth", "1"];
	if (gs.ref) {
		args.push("--branch", gs.ref);
	}
	args.push(gs.repo, dest);

	await runCommand("git", args);
	return verifyAddon(dest, name);
}

async function installFromNpm(spec: string, targetDir: string): Promise<InstallResult> {
	const name = deriveNpmName(spec);
	const dest = join(targetDir, name);
	removePath(dest);

	const tmpDir = join(targetDir, `.npm-pack-${name}-${process.pid}`);
	mkdirSync(tmpDir, { recursive: true });
	try {
		const tarballName = await captureCommand("npm", ["pack", spec, "--pack-destination", tmpDir], {
			cwd: tmpDir,
		});
		const tarballPath = resolve(tmpDir, tarballName);
		mkdirSync(dest, { recursive: true });
		await runCommand("tar", ["-xzf", tarballPath, "-C", dest, "--strip-components=1"]);
	} finally {
		removePath(tmpDir);
	}

	return verifyAddon(dest, name);
}

async function installFromLocal(localPath: string, targetDir: string): Promise<InstallResult> {
	const name = basename(localPath);
	const dest = join(targetDir, name);
	removePath(dest);

	try {
		symlinkSync(resolve(localPath), dest);
	} catch {
		// Symlinks may fail on Windows without privileges; fall back to a copy.
		copyDirRecursive(resolve(localPath), dest);
	}

	return verifyAddon(dest, name);
}

/**
 * Verify the installed directory contains at least one addon component.
 * If not, remove it and return an error. Returns the addon name from the
 * manifest when available, falling back to the directory name.
 */
async function verifyAddon(dest: string, fallbackName: string): Promise<InstallResult> {
	const addon = loadAddon(dest);
	if (!addon) {
		removePath(dest);
		return {
			success: false,
			path: "",
			name: fallbackName,
			error: "Installed addon has no addon components (skills/, extension.ts, mcp.json, or SKILL.md)",
		};
	}
	return { success: true, path: resolve(dest), name: addon.name };
}

function deriveNpmName(spec: string): string {
	const withoutVersion = spec.replace(/@[^/@]*$/, "");
	const withoutScope = withoutVersion.replace(/^@[^/]+\//, "");
	return withoutScope || withoutVersion || "addon";
}

function copyDirRecursive(src: string, dest: string): void {
	mkdirSync(dest, { recursive: true });
	for (const entry of readdirSync(src)) {
		const srcPath = join(src, entry);
		const destPath = join(dest, entry);
		if (statSync(srcPath).isDirectory()) {
			copyDirRecursive(srcPath, destPath);
		} else {
			copyFileSync(srcPath, destPath);
		}
	}
}

function removePath(p: string): void {
	if (existsSync(p)) {
		rmSync(p, { recursive: true, force: true });
	}
}

function runCommand(command: string, args: string[], options?: { cwd?: string }): Promise<void> {
	return new Promise((resolvePromise, reject) => {
		const child = spawnProcess(command, args, {
			cwd: options?.cwd,
			stdio: "inherit",
		});
		child.on("error", reject);
		child.on("exit", (code) => {
			if (code === 0) {
				resolvePromise();
			} else {
				reject(new Error(`${command} ${args.join(" ")} failed with code ${code}`));
			}
		});
	});
}

function captureCommand(command: string, args: string[], options?: { cwd?: string }): Promise<string> {
	return new Promise((resolvePromise, reject) => {
		const child = spawnProcess(command, args, {
			cwd: options?.cwd,
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		child.stdout?.on("data", (chunk: Buffer | string) => {
			stdout += chunk;
		});
		child.stderr?.on("data", (chunk: Buffer | string) => {
			stderr += chunk;
		});
		child.on("error", reject);
		child.on("exit", (code) => {
			if (code === 0) {
				resolvePromise(stdout.trim());
			} else {
				reject(new Error(`${command} ${args.join(" ")} failed with code ${code}: ${stderr.trim()}`));
			}
		});
	});
}
