import { describe, expect, it } from "vitest";
import { createLoopGuard, stripVolatileIds } from "../src/core/loop-guard.ts";

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

describe("stripVolatileIds", () => {
	it("normalizes per-run temp-file ids so identical runs hash equal", () => {
		const a = stripVolatileIds("npm install failed. Full output: /tmp/pi-bash-deadbeefcafe1234.log");
		const b = stripVolatileIds("npm install failed. Full output: /tmp/pi-bash-0123456789abcdef.log");
		expect(a).toBe(b); // different random ids -> same normalized signature
		expect(a).toContain("-tmp.log");
	});

	it("leaves signatures without temp ids unchanged", () => {
		expect(stripVolatileIds("read:foo.ts##content")).toBe("read:foo.ts##content");
	});
});
