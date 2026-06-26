import { describe, expect, it } from "vitest";
import { DEEP_WORK, getPreset, listPresets, REVIEW, SIMPLE } from "../../src/core/subagent/presets.ts";

describe("subagent presets", () => {
	it("SIMPLE is a single-pass preset with write-capable tools and references ponytail", () => {
		expect(SIMPLE.name).toBe("simple");
		expect(SIMPLE.strategy).toBe("single");
		expect(SIMPLE.tools).toEqual(expect.arrayContaining(["read", "bash", "edit", "write"]));
		expect(SIMPLE.systemPrompt.toLowerCase()).toContain("ponytail");
	});

	it("DEEP_WORK is a deep-work preset that adds search tools and names the phases", () => {
		expect(DEEP_WORK.name).toBe("deep-work");
		expect(DEEP_WORK.strategy).toBe("deep-work");
		expect(DEEP_WORK.tools).toEqual(expect.arrayContaining(["read", "bash", "edit", "write", "grep", "find"]));
		const prompt = DEEP_WORK.systemPrompt.toLowerCase();
		expect(prompt).toContain("spec");
		expect(prompt).toContain("plan");
		expect(prompt).toContain("execute");
		expect(prompt).toContain("review");
		expect(prompt).toContain("system-prompts");
		expect(prompt).toContain("ponytail");
	});

	it("getPreset resolves known names and rejects unknown ones", () => {
		expect(getPreset("simple")).toBe(SIMPLE);
		expect(getPreset("deep-work")).toBe(DEEP_WORK);
		expect(getPreset("review")).toBe(REVIEW);
		expect(getPreset("nope")).toBeUndefined();
	});

	it("listPresets returns all built-in presets", () => {
		expect(listPresets().map((p) => p.name).sort()).toEqual(["deep-work", "review", "simple"]);
	});
});
