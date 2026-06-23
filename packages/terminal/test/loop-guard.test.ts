import { describe, expect, it } from "vitest";
import { createLoopGuard } from "../src/core/loop-guard.ts";

describe("createLoopGuard", () => {
	it("trips only once the same signature repeats `threshold` times in a row", () => {
		const g = createLoopGuard(3);
		expect(g.record("a")).toBe(false); // 1
		expect(g.record("a")).toBe(false); // 2
		expect(g.record("a")).toBe(true); // 3 -> trip
	});

	it("resets the streak when the signature changes (legit iteration never trips)", () => {
		const g = createLoopGuard(3);
		g.record("a");
		g.record("a");
		expect(g.record("b")).toBe(false); // changed -> streak resets to 1
		expect(g.record("b")).toBe(false); // 2
		expect(g.record("a")).toBe(false); // changed again -> 1
	});

	it("reset() clears the streak", () => {
		const g = createLoopGuard(2);
		g.record("a");
		g.reset();
		expect(g.record("a")).toBe(false); // back to 1 after reset
	});
});
