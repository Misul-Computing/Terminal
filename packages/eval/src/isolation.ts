/** Per-run filesystem isolation: clone a fixture's input into a temp dir. */

import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EvalFixture } from "./types.ts";

/**
 * Copy `fixture.inputDir` into a fresh `os.tmpdir()` directory and return its
 * path. The agent edits this clone; the original fixture stays pristine. The
 * seed is encoded in the dir name for traceability.
 */
export function cloneToRunDir(fixture: EvalFixture, seed: number): string {
	const runDir = mkdtempSync(join(tmpdir(), `misul-eval-${fixture.id}-s${seed}-`));
	cpSync(fixture.inputDir, runDir, { recursive: true });
	return runDir;
}

/** Remove a run dir. Non-throwing — cleanup must never fail a run. */
export function cleanupRunDir(runDir: string): void {
	try {
		rmSync(runDir, { recursive: true, force: true });
	} catch {
		// best-effort
	}
}
