import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { loadFixtures } from "../src/fixtures.ts";
import { cleanupRunDir, cloneToRunDir } from "../src/isolation.ts";

const fixturesRoot = fileURLToPath(new URL("../fixtures", import.meta.url));

describe("loadFixtures", () => {
	it("loads all 5 Tier-1 fixtures with valid contracts", () => {
		const fixtures = loadFixtures(fixturesRoot);
		expect(fixtures.length).toBe(5);
		const ids = fixtures.map((f) => f.id).sort();
		expect(ids).toEqual([
			"01-add-return-type",
			"02-fix-null-guard",
			"03-rename-symbol",
			"04-add-error-case",
			"05-extract-constant",
		]);
		for (const f of fixtures) {
			expect(f.prompt.length).toBeGreaterThan(0);
			expect(f.metadata.testCommand.length).toBeGreaterThan(0);
			expect(existsSync(f.inputDir)).toBe(true);
		}
	});

	it("filters by ids", () => {
		const fixtures = loadFixtures(fixturesRoot, { ids: ["01-add-return-type"] });
		expect(fixtures.map((f) => f.id)).toEqual(["01-add-return-type"]);
	});
});

describe("cloneToRunDir / cleanupRunDir", () => {
	const dirs: string[] = [];
	afterEach(() => {
		for (const d of dirs.splice(0)) cleanupRunDir(d);
	});

	it("copies the input subtree into an isolated temp dir", () => {
		const [fixture] = loadFixtures(fixturesRoot, { ids: ["01-add-return-type"] });
		const runDir = cloneToRunDir(fixture, 7);
		dirs.push(runDir);
		expect(existsSync(join(runDir, "src", "math.ts"))).toBe(true);
		expect(existsSync(join(runDir, "math.test.mjs"))).toBe(true);
		// Each clone is a distinct directory.
		const runDir2 = cloneToRunDir(fixture, 8);
		dirs.push(runDir2);
		expect(runDir2).not.toBe(runDir);
		// Mutating one clone must not touch the source fixture.
		const original = readFileSync(join(fixture.inputDir, "src", "math.ts"), "utf8");
		expect(original).toContain("function add");
	});

	it("cleanupRunDir removes the directory", () => {
		const [fixture] = loadFixtures(fixturesRoot, { ids: ["02-fix-null-guard"] });
		const runDir = cloneToRunDir(fixture, 1);
		expect(existsSync(runDir)).toBe(true);
		cleanupRunDir(runDir);
		expect(existsSync(runDir)).toBe(false);
	});
});
