import { describe, expect, test } from "vitest";
import { buildSystemPromptWithBlocks } from "../src/core/system-prompt.ts";

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

describe("buildSystemPromptWithBlocks - cache stability", () => {
	test("identical inputs produce identical prefix hash", () => {
		const a = buildSystemPromptWithBlocks({ ...baseOptions });
		const b = buildSystemPromptWithBlocks({ ...baseOptions });

		expect(a.prompt).toBe(b.prompt);
		expect(a.prefixHash).toBe(b.prefixHash);
		expect(a.blocks.map((bl) => bl.hash)).toEqual(b.blocks.map((bl) => bl.hash));
	});

	test("changing one context file changes only project_context block", () => {
		const before = buildSystemPromptWithBlocks({
			...baseOptions,
			contextFiles: [{ path: "AGENTS.md", content: "rule A" }],
		});
		const after = buildSystemPromptWithBlocks({
			...baseOptions,
			contextFiles: [{ path: "AGENTS.md", content: "rule B" }],
		});

		expect(before.prompt).not.toBe(after.prompt);
		expect(before.prefixHash).not.toBe(after.prefixHash);

		const beforeCtx = before.blocks.find((b) => b.id === "project_context");
		const afterCtx = after.blocks.find((b) => b.id === "project_context");
		expect(beforeCtx).toBeDefined();
		expect(afterCtx).toBeDefined();
		expect(beforeCtx!.hash).not.toBe(afterCtx!.hash);

		// All other blocks should be unchanged.
		const beforeOthers = before.blocks.filter((b) => b.id !== "project_context");
		const afterOthers = after.blocks.filter((b) => b.id !== "project_context");
		expect(beforeOthers.map((b) => b.hash)).toEqual(afterOthers.map((b) => b.hash));
	});

	test("changing tools changes only tools and guidelines blocks", () => {
		const before = buildSystemPromptWithBlocks({
			...baseOptions,
			selectedTools: ["read", "bash", "edit", "write"],
		});
		const after = buildSystemPromptWithBlocks({
			...baseOptions,
			selectedTools: ["read", "bash", "edit", "write", "grep"],
			toolSnippets: {
				...baseOptions.toolSnippets,
				grep: "Search file contents",
			},
		});

		const changedIds = new Set<string>();
		for (let i = 0; i < before.blocks.length; i++) {
			if (before.blocks[i].hash !== after.blocks[i].hash) {
				changedIds.add(before.blocks[i].id);
			}
		}
		expect(changedIds.has("tools")).toBe(true);
		expect(changedIds.has("guidelines")).toBe(true);
		// Constitution, env, etc. should not change.
		expect(changedIds.has("constitution")).toBe(false);
		expect(changedIds.has("env")).toBe(false);
	});

	test("no date or timestamp in prompt text", () => {
		const prompt = buildSystemPromptWithBlocks({ ...baseOptions }).prompt;

		// Should not contain "Current date:" (removed for cache stability).
		expect(prompt).not.toContain("Current date:");
		// Should not contain any ISO date pattern.
		expect(prompt).not.toMatch(/\d{4}-\d{2}-\d{2}/);
	});

	test("block ids are stable and ordered", () => {
		const result = buildSystemPromptWithBlocks({ ...baseOptions });
		const ids = result.blocks.map((b) => b.id);

		// The canonical layer order from docs/cache-aware-design.md.
		expect(ids).toEqual(["constitution", "tools", "guidelines", "env"]);
	});

	test("block ids with memory and context files", () => {
		const result = buildSystemPromptWithBlocks({
			...baseOptions,
			contextFiles: [{ path: "AGENTS.md", content: "rules" }],
			memory: { path: "~/.misul/memory.md", content: "remember this" } as any,
		});
		const ids = result.blocks.map((b) => b.id);

		expect(ids).toEqual(["constitution", "tools", "guidelines", "memory", "project_context", "env"]);
	});

	test("prefix hash is 64-char hex (SHA-256)", () => {
		const result = buildSystemPromptWithBlocks({ ...baseOptions });
		expect(result.prefixHash).toMatch(/^[0-9a-f]{64}$/);
		for (const block of result.blocks) {
			expect(block.hash).toMatch(/^[0-9a-f]{64}$/);
		}
	});

	test("context files sorted by path regardless of input order", () => {
		const unsorted = buildSystemPromptWithBlocks({
			...baseOptions,
			contextFiles: [
				{ path: "z-agents.md", content: "z" },
				{ path: "a-agents.md", content: "a" },
				{ path: "m-agents.md", content: "m" },
			],
		});
		const sorted = buildSystemPromptWithBlocks({
			...baseOptions,
			contextFiles: [
				{ path: "a-agents.md", content: "a" },
				{ path: "m-agents.md", content: "m" },
				{ path: "z-agents.md", content: "z" },
			],
		});

		expect(unsorted.prompt).toBe(sorted.prompt);
		expect(unsorted.prefixHash).toBe(sorted.prefixHash);
	});
});
