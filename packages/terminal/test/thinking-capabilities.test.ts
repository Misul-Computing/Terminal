import type { Model } from "@misul/ai";
import { describe, expect, test } from "vitest";
import {
	PROBE_TIERS,
	clearProbedThinkingLevels,
	getProbedThinkingLevels,
	isModelProbed,
	recordProbedThinkingLevels,
} from "../src/core/thinking-capabilities.ts";

function makeModel(id = "test/glm-future", reasoning = true): Model<"openai-completions"> {
	return {
		id,
		provider: id.split("/")[0],
		reasoning,
		thinkingLevelMap: { off: "off", minimal: null, low: null, medium: null, high: "high", xhigh: null, max: "max" },
	} as unknown as Model<"openai-completions">;
}

describe("thinking-capabilities", () => {
	test("getProbedThinkingLevels returns undefined for an unprobed model", () => {
		const model = makeModel("test/unprobed");
		expect(getProbedThinkingLevels(model)).toBeUndefined();
		expect(isModelProbed(model)).toBe(false);
	});

	test("recordProbedThinkingLevels filters the selector to probed tiers + off", () => {
		const model = makeModel("test/probed");
		// Probe discovers only "high" is accepted (build-time map also has "max").
		recordProbedThinkingLevels(model, ["high"]);

		expect(isModelProbed(model)).toBe(true);
		const levels = getProbedThinkingLevels(model)!;
		expect(levels).toContain("off");
		expect(levels).toContain("high");
		expect(levels).not.toContain("max");
		expect(levels).not.toContain("low");
	});

	test("clearProbedThinkingLevels removes the cache entry", () => {
		const model = makeModel("test/cleared");
		recordProbedThinkingLevels(model, ["high", "max"]);
		expect(isModelProbed(model)).toBe(true);
		clearProbedThinkingLevels(model);
		expect(isModelProbed(model)).toBe(false);
		expect(getProbedThinkingLevels(model)).toBeUndefined();
	});

	test("PROBE_TIERS excludes off (off is a disable, not an effort)", () => {
		expect(PROBE_TIERS).not.toContain("off");
		expect(PROBE_TIERS).toContain("high");
		expect(PROBE_TIERS).toContain("max");
	});
});
