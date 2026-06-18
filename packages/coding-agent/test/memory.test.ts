import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getMemoryPath, loadMemory } from "../src/core/memory.ts";
import { buildSystemPrompt } from "../src/core/system-prompt.ts";

describe("agent memory", () => {
	let agentDir: string;

	beforeEach(() => {
		agentDir = mkdtempSync(join(tmpdir(), "misul-memory-"));
	});

	afterEach(() => {
		rmSync(agentDir, { recursive: true, force: true });
	});

	it("returns undefined when no memory file exists", () => {
		expect(loadMemory(agentDir)).toBeUndefined();
	});

	it("loads memory content and path when present", () => {
		const path = getMemoryPath(agentDir);
		mkdirSync(join(agentDir, "memory"), { recursive: true });
		writeFileSync(path, "User prefers tabs.\n", "utf-8");

		const mem = loadMemory(agentDir);
		expect(mem?.content).toBe("User prefers tabs.");
		expect(mem?.path).toBe(path);
	});

	it("treats an empty/whitespace memory file as no memory", () => {
		mkdirSync(join(agentDir, "memory"), { recursive: true });
		writeFileSync(getMemoryPath(agentDir), "   \n\n", "utf-8");
		expect(loadMemory(agentDir)).toBeUndefined();
	});

	it("injects a <memory> section into the system prompt when memory is present", () => {
		const prompt = buildSystemPrompt({
			cwd: process.cwd(),
			memory: { path: "/x/MEMORY.md", content: "User prefers tabs." },
		});
		expect(prompt).toContain('<memory path="/x/MEMORY.md">');
		expect(prompt).toContain("User prefers tabs.");
		expect(prompt).toContain("Apply it silently");
	});

	it("injects no memory section when there is no memory", () => {
		const prompt = buildSystemPrompt({ cwd: process.cwd() });
		expect(prompt).not.toContain("<memory");
	});
});
