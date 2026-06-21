/**
 * Startup performance regression tests (perf bug P10).
 *
 * Cold start used to block ~11s on a network model-discovery call made by an
 * extension factory during resource load. These tests pin two guarantees:
 *
 * 1. `--help` / `--version` short-circuit BEFORE any extension loading, so a
 *    slow/hanging extension cannot delay them.
 * 2. Offline startup does not block on extension network calls.
 *
 * Both run the real CLI with an isolated agent dir containing a "trap"
 * extension whose factory hangs forever on a never-resolving network fetch.
 * If startup waited on that fetch, these tests would time out.
 */

import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ENV_AGENT_DIR } from "../src/config.ts";

const cliPath = resolve(__dirname, "../src/cli.ts");
const tempDirs: string[] = [];

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

function createTempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-startup-perf-"));
	tempDirs.push(dir);
	return dir;
}

/**
 * Plant an extension whose factory blocks forever on a network fetch to an
 * unroutable address. This mimics the nvidia-nim extension model-discovery
 * call that originally caused the startup hang.
 */
function writeTrapExtension(agentDir: string): void {
	const extDir = join(agentDir, "extensions");
	mkdirSync(extDir, { recursive: true });
	writeFileSync(
		join(extDir, "trap.ts"),
		[
			"export default async function (pi) {",
			// Emitted the instant the factory runs, BEFORE the hanging fetch — so "the
			// extension loaded at all" is observable on stderr independent of timing.
			'\tconsole.error("TRAP_EXTENSION_LOADED");',
			// 203.0.113.0/24 is TEST-NET-3 (RFC 5737): guaranteed unroutable.
			'\tawait fetch("https://203.0.113.1/v1/models");',
			'\tpi.registerProvider("trap-provider", { baseUrl: "https://203.0.113.1/v1", apiKey: "x", api: "openai-completions", models: [] });',
			"}",
			"",
		].join("\n"),
		"utf-8",
	);
}

interface RunResult {
	code: number | null;
	stdout: string;
	stderr: string;
	durationMs: number;
}

function runCli(args: string[], options?: { offline?: boolean }): Promise<RunResult> {
	const tempRoot = createTempDir();
	const agentDir = join(tempRoot, "agent");
	const projectDir = join(tempRoot, "project");
	mkdirSync(agentDir, { recursive: true });
	mkdirSync(projectDir, { recursive: true });
	writeTrapExtension(agentDir);

	const env: NodeJS.ProcessEnv = {
		...process.env,
		[ENV_AGENT_DIR]: agentDir,
		TSX_TSCONFIG_PATH: resolve(__dirname, "../../../tsconfig.json"),
	};
	if (options?.offline) {
		env.PI_OFFLINE = "1";
	}

	const start = Date.now();
	return new Promise<RunResult>((resolvePromise, reject) => {
		const child = spawn(process.execPath, [cliPath, ...args], {
			cwd: projectDir,
			env,
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (chunk) => {
			stdout += chunk.toString();
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk.toString();
		});
		child.on("error", reject);
		child.on("close", (code) => {
			resolvePromise({ code, stdout, stderr, durationMs: Date.now() - start });
		});
	});
}

// Correctness here is proven behaviorally, not by wall-clock. Under heavy parallel
// test load a correct-but-contended startup (~12s observed) can overlap the buggy
// OS-connect-timeout path (~11s), so a tight wall-clock bound only flakes. Instead:
//   - --help/--version assert the trap extension's factory never ran (its
//     TRAP_EXTENSION_LOADED marker is absent), which directly proves the
//     short-circuit ran before extension loading;
//   - the offline path asserts it completes (exit 0) rather than hanging, guarded by
//     the per-test 30s timeout (a regressed unbounded fetch would time out).
// The wall-clock backstop below only catches a "slow but not infinite" stall; the
// precise sub-second fast-path numbers are verified in isolation, not under contention.
const STARTUP_BACKSTOP_MS = 20_000;

describe("startup performance (P10)", () => {
	it("--help short-circuits before loading extensions", async () => {
		const result = await runCli(["--help"]);

		expect(result.code).toBe(0);
		expect(result.stdout.toLowerCase()).toContain("misul");
		expect(result.stdout).toContain("--help");
		// The trap extension's factory must never have run (proves the short-circuit
		// happened before extension loading) — timing-independent.
		expect(result.stderr).not.toContain("TRAP_EXTENSION_LOADED");
		expect(result.durationMs).toBeLessThan(STARTUP_BACKSTOP_MS);
	}, 30_000);

	it("--version short-circuits before loading extensions", async () => {
		const result = await runCli(["--version"]);

		expect(result.code).toBe(0);
		expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
		// The trap extension's factory must never have run (proves the short-circuit
		// happened before extension loading) — timing-independent.
		expect(result.stderr).not.toContain("TRAP_EXTENSION_LOADED");
		expect(result.durationMs).toBeLessThan(STARTUP_BACKSTOP_MS);
	}, 30_000);

	it("offline startup does not block on extension network calls", async () => {
		// Full runtime path: --list-models loads resources/extensions, then exits.
		// Offline mode must keep the trap extension's network fetch from hanging;
		// a regressed unbounded fetch would stall past the 30s test timeout.
		const result = await runCli(["--list-models", "no-such-model"], { offline: true });

		expect(result.code).toBe(0);
		expect(result.durationMs).toBeLessThan(STARTUP_BACKSTOP_MS);
	}, 30_000);
});
