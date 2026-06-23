import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getRecentlyEditedFiles, parseRecentFiles } from "../src/core/recent-files.ts";

describe("parseRecentFiles", () => {
	it("dedupes and preserves most-recent-first order", () => {
		const out = "a.ts\nb.ts\n\nb.ts\nc.ts\n\na.ts\nd.ts\n";
		expect(parseRecentFiles(out, 10)).toEqual(["a.ts", "b.ts", "c.ts", "d.ts"]);
	});
	it("respects the limit", () => {
		expect(parseRecentFiles("a\nb\nc\nd\n", 2)).toEqual(["a", "b"]);
	});
	it("returns [] for empty output", () => {
		expect(parseRecentFiles("", 10)).toEqual([]);
	});
});

describe("getRecentlyEditedFiles", () => {
	const dirs: string[] = [];
	afterEach(() => {
		for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
	});

	it("returns [] outside a git repo (never throws)", async () => {
		const dir = mkdtempSync(join(tmpdir(), "misul-recent-nongit-"));
		dirs.push(dir);
		expect(await getRecentlyEditedFiles(dir)).toEqual([]);
	});

	it("lists committed files in a git repo", async () => {
		const dir = mkdtempSync(join(tmpdir(), "misul-recent-git-"));
		dirs.push(dir);
		const git = (args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "ignore" });
		try {
			git(["init"]);
			git(["config", "user.email", "t@t.t"]);
			git(["config", "user.name", "t"]);
			writeFileSync(join(dir, "alpha.ts"), "x");
			writeFileSync(join(dir, "beta.ts"), "y");
			git(["add", "."]);
			git(["commit", "-m", "init"]);
		} catch {
			return; // git not available — skip
		}
		const files = await getRecentlyEditedFiles(dir);
		expect(files).toContain("alpha.ts");
		expect(files).toContain("beta.ts");
	});
});
