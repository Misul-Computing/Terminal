/**
 * Tests for non-determinism sources in the system prompt.
 *
 * Each test demonstrates a specific way the cacheable prefix can change
 * between sessions or machines, breaking prompt cache hits.
 */
import { describe, expect, test } from "vitest";
import { buildSystemPromptWithBlocks } from "../src/core/system-prompt.ts";
import { formatSkillsForPrompt, type Skill } from "../src/core/skills.ts";
import { getDocsPath } from "../src/config.ts";

function makeSkill(name: string, filePath: string, description = "desc"): Skill {
	return {
		name,
		description,
		filePath,
		baseDir: filePath.replace(/\/SKILL\.md$/, ""),
		sourceInfo: {
			source: "bundled",
			scope: "global",
			baseDir: filePath.replace(/\/SKILL\.md$/, ""),
			originalPath: filePath,
		} as any,
		disableModelInvocation: false,
	};
}

const baseOptions = {
	cwd: "/home/user/project",
	contextFiles: [],
	skills: [],
	toolSnippets: {
		read: "Read file contents",
		bash: "Execute bash commands",
		edit: "Make surgical edits",
		write: "Create or overwrite files",
	},
};

describe("skills determinism", () => {
	test("skills are sorted by name regardless of input order", () => {
		const skillsZ = makeSkill("zebra-skill", "/home/user/.misul/agent/skills/zebra-skill/SKILL.md");
		const skillsA = makeSkill("alpha-skill", "/home/user/.misul/agent/skills/alpha-skill/SKILL.md");
		const skillsM = makeSkill("mid-skill", "/home/user/.misul/agent/skills/mid-skill/SKILL.md");

		const unsorted = formatSkillsForPrompt([skillsZ, skillsA, skillsM]);
		const sorted = formatSkillsForPrompt([skillsA, skillsM, skillsZ]);

		expect(unsorted).toBe(sorted);
	});

	test("skills block is identical regardless of input order in full prompt", () => {
		const skillsZ = makeSkill("zebra-skill", "/home/user/.misul/agent/skills/zebra-skill/SKILL.md");
		const skillsA = makeSkill("alpha-skill", "/home/user/.misul/agent/skills/alpha-skill/SKILL.md");

		const a = buildSystemPromptWithBlocks({
			...baseOptions,
			skills: [skillsZ, skillsA],
		});
		const b = buildSystemPromptWithBlocks({
			...baseOptions,
			skills: [skillsA, skillsZ],
		});

		expect(a.prompt).toBe(b.prompt);
		expect(a.prefixHash).toBe(b.prefixHash);
	});

	test("skill location does not leak absolute home directory path", () => {
		const skill = makeSkill("my-skill", "/home/specificuser/.misul/agent/skills/my-skill/SKILL.md");
		const text = formatSkillsForPrompt([skill]);

		// The absolute path with a machine-specific home directory should not
		// appear verbatim in the prompt. A stable representation (skill name,
		// relative path, or scoped label) should be used instead.
		expect(text).not.toContain("/home/specificuser/");
	});

	test("skill location is stable across different install paths", () => {
		const skill1 = makeSkill("my-skill", "/home/userA/.misul/agent/skills/my-skill/SKILL.md");
		const skill2 = makeSkill("my-skill", "/home/userB/.misul/agent/skills/my-skill/SKILL.md");

		const text1 = formatSkillsForPrompt([skill1]);
		const text2 = formatSkillsForPrompt([skill2]);

		// Same skill name should produce the same prompt text regardless of
		// which machine's filesystem path it was loaded from.
		expect(text1).toBe(text2);
	});
});

describe("env block determinism", () => {
	test("env block does not contain absolute docs install path", () => {
		const result = buildSystemPromptWithBlocks({ ...baseOptions });
		const envBlock = result.blocks.find((b) => b.id === "env");
		expect(envBlock).toBeDefined();

		// getDocsPath() returns an absolute path that varies between machines
		// and install methods. It should not appear verbatim in the prompt.
		const docsPath = getDocsPath();
		expect(envBlock!.text).not.toContain(docsPath);
	});

	test("env block is identical across different package install paths", () => {
		// The env block should not depend on where the package is installed.
		// Only the cwd (which is project-specific, not install-specific) should
		// appear, and even that should be stable for the same project.
		const a = buildSystemPromptWithBlocks({ ...baseOptions });
		const b = buildSystemPromptWithBlocks({ ...baseOptions });

		const envA = a.blocks.find((b) => b.id === "env");
		const envB = b.blocks.find((b) => b.id === "env");
		expect(envA!.hash).toBe(envB!.hash);
	});
});

describe("context file path determinism", () => {
	test("context file paths are relative, not absolute machine paths", () => {
		const result = buildSystemPromptWithBlocks({
			...baseOptions,
			contextFiles: [
				{ path: "/home/user/project/AGENTS.md", content: "rules" },
			],
		});

		// The absolute path should not appear in the prompt. A relative
		// representation (relative to cwd) should be used instead.
		expect(result.prompt).not.toContain("/home/user/project/AGENTS.md");
	});

	test("context files with same relative content produce same hash regardless of absolute prefix", () => {
		const a = buildSystemPromptWithBlocks({
			...baseOptions,
			cwd: "/home/user/project",
			contextFiles: [
				{ path: "/home/user/project/AGENTS.md", content: "rules" },
			],
		});
		const b = buildSystemPromptWithBlocks({
			...baseOptions,
			cwd: "/home/user/project",
			contextFiles: [
				{ path: "AGENTS.md", content: "rules" },
			],
		});

		// Both should produce the same project_context block since the file
		// is the same relative to cwd.
		const ctxA = a.blocks.find((b) => b.id === "project_context");
		const ctxB = b.blocks.find((b) => b.id === "project_context");
		expect(ctxA!.hash).toBe(ctxB!.hash);
	});
});
