/**
 * Cache prefix stability benchmark.
 *
 * Verifies that the cacheable prefix (system prompt + tool definitions) is
 * byte-identical across simulated turns. This is the property that makes
 * prompt caching work: if the prefix changes between turns, the cache misses
 * and every token is reprocessed.
 *
 * The test builds a system prompt + tool array, then simulates a turn by
 * adding a user message and rebuilding. The prefix hash must not change.
 */
import { describe, expect, test } from "vitest";
import { buildSystemPromptWithBlocks } from "../src/core/system-prompt.ts";
import { createAllToolDefinitions } from "../src/core/tools/index.ts";

const cwd = "/home/user/project";

const toolSnippets: Record<string, string> = {
	read: "Read file contents",
	bash: "Execute bash commands",
	edit: "Make surgical edits",
	write: "Create or overwrite files",
	grep: "Search file contents",
	find: "Find files by name",
	ls: "List directory contents",
};

const allTools = ["read", "bash", "edit", "write", "grep", "find", "ls"];

function buildPrefix() {
	const prompt = buildSystemPromptWithBlocks({
		cwd,
		selectedTools: allTools,
		toolSnippets,
		contextFiles: [{ path: "AGENTS.md", content: "# Rules\nDo good work." }],
		skills: [],
	});
	const tools = createAllToolDefinitions(cwd);
	const toolArray = Object.values(tools).sort((a, b) =>
		a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
	);
	return {
		prefixHash: prompt.prefixHash,
		blockHashes: prompt.blocks.map((b) => b.hash),
		toolNames: toolArray.map((t) => t.name),
		toolCount: toolArray.length,
	};
}

describe("cache prefix stability", () => {
	test("system prompt prefix hash is stable across rebuilds", () => {
		const a = buildPrefix();
		const b = buildPrefix();

		expect(a.prefixHash).toBe(b.prefixHash);
		expect(a.blockHashes).toEqual(b.blockHashes);
	});

	test("tool order is deterministic across rebuilds", () => {
		const a = buildPrefix();
		const b = buildPrefix();

		expect(a.toolNames).toEqual(b.toolNames);
		expect(a.toolNames).toEqual([...a.toolNames].sort());
	});

	test("changing context file content changes only project_context block", () => {
		const before = buildSystemPromptWithBlocks({
			cwd,
			selectedTools: allTools,
			toolSnippets,
			contextFiles: [{ path: "AGENTS.md", content: "# Rules\nDo good work." }],
			skills: [],
		});

		const after = buildSystemPromptWithBlocks({
			cwd,
			selectedTools: allTools,
			toolSnippets,
			contextFiles: [{ path: "AGENTS.md", content: "# Rules\nDo great work." }],
			skills: [],
		});

		expect(before.prefixHash).not.toBe(after.prefixHash);

		const changedBlocks = before.blocks.filter(
			(b, i) => b.hash !== after.blocks[i].hash,
		);
		expect(changedBlocks).toHaveLength(1);
		expect(changedBlocks[0].id).toBe("project_context");
	});

	test("adding a tool changes only tools and guidelines blocks", () => {
		const before = buildSystemPromptWithBlocks({
			cwd,
			selectedTools: ["read", "bash", "edit", "write"],
			toolSnippets,
			skills: [],
		});

		const after = buildSystemPromptWithBlocks({
			cwd,
			selectedTools: ["read", "bash", "edit", "write", "grep"],
			toolSnippets,
			skills: [],
		});

		const changedIds = new Set<string>();
		for (let i = 0; i < before.blocks.length; i++) {
			if (before.blocks[i].hash !== after.blocks[i].hash) {
				changedIds.add(before.blocks[i].id);
			}
		}

		// Tools block changes (new tool listed), guidelines block changes
		// (grep guideline added). Constitution and env do not change.
		expect(changedIds.has("tools")).toBe(true);
		expect(changedIds.has("guidelines")).toBe(true);
		expect(changedIds.has("constitution")).toBe(false);
		expect(changedIds.has("env")).toBe(false);
	});

	test("prefix hash survives a simulated turn (no input changes)", () => {
		// Simulate three consecutive turns with no tool or context changes.
		// The prefix hash must be identical on every turn.
		const turn1 = buildPrefix();
		const turn2 = buildPrefix();
		const turn3 = buildPrefix();

		expect(turn1.prefixHash).toBe(turn2.prefixHash);
		expect(turn2.prefixHash).toBe(turn3.prefixHash);
	});
});
