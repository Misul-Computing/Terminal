/** Tier-1 deterministic grader: run the fixture's test command, exit 0 = pass. */

import { spawn } from "node:child_process";
import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { platform } from "node:os";
import { dirname, join, relative } from "node:path";
import type { FixtureMetadata } from "./types.ts";

const DEFAULT_TIMEOUT_MS = 120000;
/** Cap per-stream capture to avoid OOM on a runaway test command. */
const MAX_CAPTURE_BYTES = 1024 * 1024;
/** Files treated as oracle/test files when a fixture doesn't list them explicitly. */
const ORACLE_FILE_RE = /\.(test|spec)\.[cm]?[jt]sx?$/;

/** Recursively find oracle/test files under `inputDir`, returned as relative paths. */
function findOracleFiles(inputDir: string): string[] {
	const out: string[] = [];
	const walk = (dir: string): void => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			if (entry.isDirectory()) {
				if (entry.name === "node_modules" || entry.name === ".git") continue;
				walk(join(dir, entry.name));
			} else if (ORACLE_FILE_RE.test(entry.name)) {
				out.push(relative(inputDir, join(dir, entry.name)));
			}
		}
	};
	walk(inputDir);
	return out;
}

/**
 * Restore oracle files from the pristine `inputDir` over the agent-edited `runDir`
 * before grading, so an agent cannot pass by editing the test itself. Uses the
 * fixture's explicit `oracleFiles` list, or auto-detected `*.test.*`/`*.spec.*`
 * files. Best-effort per file: a listed file missing from `inputDir` is skipped.
 */
export function restoreOracleFiles(runDir: string, inputDir: string, metadata: Pick<FixtureMetadata, "oracleFiles">): void {
	const rels = metadata.oracleFiles ?? findOracleFiles(inputDir);
	for (const rel of rels) {
		try {
			const dst = join(runDir, rel);
			mkdirSync(dirname(dst), { recursive: true });
			copyFileSync(join(inputDir, rel), dst);
		} catch {
			// best-effort
		}
	}
}

export interface GradeResult {
	/** 1 when the command exited 0 and did not time out, else 0. */
	score: number;
	exitCode: number | null;
	timedOut: boolean;
	stdout: string;
	stderr: string;
}

/**
 * Spawn `metadata.testCommand` in `runDir` via the shell and grade the exit
 * code. A timeout kills the process tree and scores 0.
 */
export function gradeRunDir(
	runDir: string,
	metadata: Pick<FixtureMetadata, "testCommand" | "timeoutMs" | "oracleFiles">,
	/** Pristine fixture input dir; when given, oracle files are restored before grading. */
	inputDir?: string,
): Promise<GradeResult> {
	const timeoutMs = metadata.timeoutMs ?? DEFAULT_TIMEOUT_MS;

	if (inputDir) restoreOracleFiles(runDir, inputDir, metadata);

	return new Promise<GradeResult>((resolve) => {
		const child = spawn(metadata.testCommand, {
			cwd: runDir,
			shell: true,
			windowsHide: true,
			// POSIX: own process group so a timeout can kill the whole tree via -pid.
			detached: platform() !== "win32",
		});

		let stdout = "";
		let stderr = "";
		let stdoutTruncated = false;
		let stderrTruncated = false;
		let timedOut = false;
		let settled = false;

		const timer = setTimeout(() => {
			timedOut = true;
			killTree(child);
		}, timeoutMs);

		// Stop appending once a stream passes the cap; note that it was truncated.
		child.stdout?.on("data", (chunk) => {
			if (stdoutTruncated) return;
			if (stdout.length >= MAX_CAPTURE_BYTES) {
				stdout += "\n[truncated: stdout exceeded capture cap]";
				stdoutTruncated = true;
				return;
			}
			stdout += chunk.toString();
		});
		child.stderr?.on("data", (chunk) => {
			if (stderrTruncated) return;
			if (stderr.length >= MAX_CAPTURE_BYTES) {
				stderr += "\n[truncated: stderr exceeded capture cap]";
				stderrTruncated = true;
				return;
			}
			stderr += chunk.toString();
		});

		const finish = (exitCode: number | null) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve({
				score: exitCode === 0 && !timedOut ? 1 : 0,
				exitCode,
				timedOut,
				stdout,
				stderr,
			});
		};

		child.on("error", (err) => {
			stderr += String(err);
			finish(null);
		});
		child.on("close", (code) => finish(code));
	});
}

/**
 * Kill the spawned shell and any grandchildren. With `shell: true` the direct
 * child is the shell; `child.kill` alone leaves the actual command process
 * lingering until its own timers fire. On Windows we use `taskkill /T`, on
 * POSIX we signal the process group.
 *
 * `taskkill` is itself a spawned process that can fail (PID already gone, not on
 * PATH); we attach handlers and fall back to `child.kill()` rather than assuming
 * it succeeded.
 */
function killTree(child: ReturnType<typeof spawn>): void {
	const pid = child.pid;
	if (pid == null) return;
	try {
		if (platform() === "win32") {
			const killer = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true });
			// Don't assume taskkill ran: on spawn error or a non-zero exit, fall
			// back to killing the direct child so the timeout still terminates it.
			killer.on("error", () => {
				try {
					child.kill();
				} catch {
					// best-effort
				}
			});
			killer.on("exit", (code) => {
				if (code !== 0) {
					try {
						child.kill();
					} catch {
						// best-effort
					}
				}
			});
		} else {
			process.kill(-pid, "SIGKILL");
		}
	} catch {
		// best-effort
	}
}
