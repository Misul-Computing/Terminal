import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { gradeRunDir } from "../src/grader.ts";

const dirs: string[] = [];
function tempDir(): string {
	const d = mkdtempSync(join(tmpdir(), "misul-grader-"));
	dirs.push(d);
	return d;
}
afterEach(() => {
	for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("gradeRunDir", () => {
	it("scores 1 when the test command exits 0", async () => {
		const result = await gradeRunDir(tempDir(), { testCommand: 'node -e "process.exit(0)"' });
		expect(result.score).toBe(1);
		expect(result.exitCode).toBe(0);
		expect(result.timedOut).toBe(false);
	});

	it("scores 0 when the test command exits non-zero", async () => {
		const result = await gradeRunDir(tempDir(), { testCommand: 'node -e "process.exit(1)"' });
		expect(result.score).toBe(0);
		expect(result.exitCode).toBe(1);
		expect(result.timedOut).toBe(false);
	});

	it("scores 0 and flags timeout when the command runs too long", async () => {
		const result = await gradeRunDir(tempDir(), {
			testCommand: 'node -e "setTimeout(()=>{}, 10000)"',
			timeoutMs: 300,
		});
		expect(result.score).toBe(0);
		expect(result.timedOut).toBe(true);
	});

	it("truncates huge stdout instead of buffering it unbounded", async () => {
		// Emit ~8 MB of stdout; capture must be capped well below that.
		const result = await gradeRunDir(tempDir(), {
			testCommand:
				'node -e "const c=Buffer.alloc(1024*1024,65).toString();for(let i=0;i<8;i++)process.stdout.write(c);process.exit(1)"',
			timeoutMs: 30000,
		});
		expect(result.exitCode).toBe(1);
		// Capped at ~1 MB plus a short truncation marker; never the full 8 MB.
		expect(result.stdout.length).toBeLessThan(2 * 1024 * 1024);
		expect(result.stdout).toContain("truncated");
	});
});
