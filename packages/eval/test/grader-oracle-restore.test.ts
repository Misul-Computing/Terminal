import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { gradeRunDir } from "../src/index.ts";

const dirs: string[] = [];
function tmp(prefix: string): string {
	const d = mkdtempSync(join(tmpdir(), prefix));
	dirs.push(d);
	return d;
}
afterEach(() => {
	for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("grader oracle-file restoration (anti-gaming)", () => {
	it("restores a tampered test file from input before grading, foiling a cheat", async () => {
		const inputDir = tmp("eval-oracle-in-");
		// Pristine oracle: a test that FAILS (the task is unsolved).
		writeFileSync(join(inputDir, "x.test.mjs"), "process.exit(1)\n");

		const runDir = tmp("eval-oracle-run-");
		cpSync(inputDir, runDir, { recursive: true });
		// Agent "cheats" by rewriting the test to always pass.
		writeFileSync(join(runDir, "x.test.mjs"), "process.exit(0)\n");

		const metadata = { testCommand: "node x.test.mjs" };

		// Without restore (no inputDir): the cheat succeeds — this is the gap.
		expect((await gradeRunDir(runDir, metadata)).score).toBe(1);

		// With restore (inputDir given): the pristine failing test is put back and runs.
		writeFileSync(join(runDir, "x.test.mjs"), "process.exit(0)\n");
		expect((await gradeRunDir(runDir, metadata, inputDir)).score).toBe(0);
	});

	it("does not restore when oracleFiles is empty (e.g. type-check oracles)", async () => {
		const inputDir = tmp("eval-oracle-in2-");
		writeFileSync(join(inputDir, "x.test.mjs"), "process.exit(1)\n");
		const runDir = tmp("eval-oracle-run2-");
		cpSync(inputDir, runDir, { recursive: true });
		writeFileSync(join(runDir, "x.test.mjs"), "process.exit(0)\n");

		const grade = await gradeRunDir(runDir, { testCommand: "node x.test.mjs", oracleFiles: [] }, inputDir);
		expect(grade.score).toBe(1);
	});
});
