import { describe, expect, it } from "vitest";
import type { Model } from "@misul/ai";
import { classifyThinkingLevel } from "../src/auto-thinking.ts";

describe("classifyThinkingLevel", () => {
	it("returns minimal for short prompts without a model call", async () => {
		const model = { reasoning: true, id: "test", provider: "test" } as unknown as Model<any>;
		const result = await classifyThinkingLevel(model, [{ role: "user", content: "hi" }], async () => {
			throw new Error("should not call model");
		});
		expect(result).toBe("minimal");
	});

	it("falls back to medium on model call error", async () => {
		const model = { reasoning: true, id: "test", provider: "test" } as unknown as Model<any>;
		const result = await classifyThinkingLevel(
			model,
			[{ role: "user", content: "Build a complex REST API with authentication and tests" }],
			async () => {
				throw new Error("network error");
			},
		);
		expect(result).toBe("medium");
	});

	it("falls back to medium when no user message exists", async () => {
		const model = { reasoning: true, id: "test", provider: "test" } as unknown as Model<any>;
		const result = await classifyThinkingLevel(model, [], async () => {
			throw new Error("should not call model");
		});
		expect(result).toBe("medium");
	});
});
