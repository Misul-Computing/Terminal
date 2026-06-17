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

// tsx cold-start adds a couple seconds. The original hang waited ~11s on the
// trap extension's network fetch (OS connect timeout). A correct fast path is
// well under this bound; the buggy path blows past it.
const FAST_STARTUP_MS = 6_000;

describe("startup performance (P10)", () => {
	it("--help short-circuits before loading extensions", async () => {
		const result = await runCli(["--help"]);

		expect(result.code).toBe(0);
		expect(result.stdout.toLowerCase()).toContain("misul");
		expect(result.stdout).toContain("--help");
		// The trap extension must never have loaded.
		expect(result.stderr).not.toContain("trap-provider");
		expect(result.durationMs).toBeLessThan(FAST_STARTUP_MS);
	}, 30_000);

	it("--version short-circuits before loading extensions", async () => {
		const result = await runCli(["--version"]);

		expect(result.code).toBe(0);
		expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
		expect(result.durationMs).toBeLessThan(FAST_STARTUP_MS);
	}, 30_000);

	it("offline startup does not block on extension network calls", async () => {
		// Full runtime path: --list-models loads resources/extensions, then exits.
		// Offline mode must keep the trap extension's network fetch from hanging.
		const result = await runCli(["--list-models", "no-such-model"], { offline: true });

		expect(result.code).toBe(0);
		expect(result.durationMs).toBeLessThan(FAST_STARTUP_MS);
	}, 30_000);
});
