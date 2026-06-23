import { afterEach, describe, expect, it, vi } from "vitest";
import { createCoalescer } from "../src/modes/interactive/coalesce.ts";

describe("createCoalescer", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("coalesces a burst of schedules into one run per window", () => {
		vi.useFakeTimers();
		const c = createCoalescer(33);
		let runs = 0;
		c.schedule(() => runs++);
		c.schedule(() => runs++);
		c.schedule(() => runs++);
		expect(runs).toBe(0); // nothing runs synchronously
		vi.advanceTimersByTime(33);
		expect(runs).toBe(1); // exactly one run for the whole burst
	});

	it("allows a fresh run after the window elapses", () => {
		vi.useFakeTimers();
		const c = createCoalescer(33);
		let runs = 0;
		c.schedule(() => runs++);
		vi.advanceTimersByTime(33);
		c.schedule(() => runs++);
		vi.advanceTimersByTime(33);
		expect(runs).toBe(2);
	});

	it("cancel() prevents a pending run (so a final flush can take over)", () => {
		vi.useFakeTimers();
		const c = createCoalescer(33);
		let runs = 0;
		c.schedule(() => runs++);
		c.cancel();
		vi.advanceTimersByTime(100);
		expect(runs).toBe(0);
	});
});
