import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getBundledSkillsDir, loadSkills } from "../src/core/skills.ts";

/**
 * Offline tests for the bundled default skills feature. Each test uses a fresh
 * temp agentDir + cwd so the user/project skill roots are empty and only the
 * bundled root contributes skills (unless the test seeds an override).
 */
describe("bundled skills", () => {
	let agentDir: string;
	let cwd: string;

	beforeEach(() => {
		agentDir = mkdtempSync(join(tmpdir(), "bundled-skills-agent-"));
		cwd = mkdtempSync(join(tmpdir(), "bundled-skills-cwd-"));
	});

	afterEach(() => {
		rmSync(agentDir, { recursive: true, force: true });
		rmSync(cwd, { recursive: true, force: true });
	});

	it("resolves a bundled skills dir that exists", () => {
		const dir = getBundledSkillsDir();
		// The dir must exist in the dev (src) layout that vitest runs in.
		expect(dir.replace(/\\/g, "/").endsWith("/skills")).toBe(true);
	});

	it("loads the bundled skills when defaults are included", () => {
		const { skills } = loadSkills({ agentDir, cwd, skillPaths: [], includeDefaults: true });
		const names = skills.map((s) => s.name);
		expect(names).toContain("ponytail");
		expect(names).toContain("system-prompts");
		expect(names).toContain("semantic-compression");
		expect(names).toContain("frontend-design");
		expect(names).toContain("api-design");

		// Bundled skills carry the "bundled" source label.
		const ponytail = skills.find((s) => s.name === "ponytail");
		expect(ponytail?.sourceInfo.source).toBe("bundled");
	});

	it("lets a user skill override a bundled skill of the same name", () => {
		const userSkillDir = join(agentDir, "skills", "ponytail");
		mkdirSync(userSkillDir, { recursive: true });
		const userSkillPath = join(userSkillDir, "SKILL.md");
		writeFileSync(
			userSkillPath,
			["---", "name: ponytail", "description: User override of the bundled ponytail skill.", "---", "", "user body"].join(
				"\n",
			),
		);

		const { skills } = loadSkills({ agentDir, cwd, skillPaths: [], includeDefaults: true });
		const ponytail = skills.find((s) => s.name === "ponytail");
		expect(ponytail).toBeDefined();
		// The user file wins the name collision over the bundled one.
		expect(ponytail?.filePath).toBe(userSkillPath);
		expect(ponytail?.sourceInfo.scope).toBe("user");
	});

	it("lets a project skill override a bundled skill of the same name", () => {
		const projectSkillDir = join(cwd, ".pi", "skills", "semantic-compression");
		mkdirSync(projectSkillDir, { recursive: true });
		const projectSkillPath = join(projectSkillDir, "SKILL.md");
		writeFileSync(
			projectSkillPath,
			[
				"---",
				"name: semantic-compression",
				"description: Project override of the bundled semantic-compression skill.",
				"---",
				"",
				"project body",
			].join("\n"),
		);

		const { skills } = loadSkills({ agentDir, cwd, skillPaths: [], includeDefaults: true });
		const sc = skills.find((s) => s.name === "semantic-compression");
		expect(sc).toBeDefined();
		expect(sc?.filePath).toBe(projectSkillPath);
		expect(sc?.sourceInfo.scope).toBe("project");
	});
});
