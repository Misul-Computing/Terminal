import assert from "node:assert";
import { afterEach, describe, it, mock } from "node:test";
import { Loader } from "../src/components/loader.ts";
import type { TUI } from "../src/tui.ts";

const fakeTui = { requestRender: () => {} } as unknown as TUI;
const id = (s: string) => s;

describe("Loader elapsed time", () => {
	afterEach(() => {
		mock.timers.reset();
	});

	it("shows live elapsed seconds when enabled and advances over time", () => {
		mock.timers.enable({ apis: ["setInterval", "Date"] });
		const loader = new Loader(fakeTui, id, id, "Working", undefined, true);
		assert.ok(loader.render(40).join("").includes("(0s)"), "starts at (0s)");

		mock.timers.tick(3000);
		const out = loader.render(40).join("");
		assert.ok(!out.includes("(0s)"), "no longer (0s) after 3s");
		assert.match(out, /\(\d+s\)/);
		loader.stop();
	});

	it("still ticks elapsed with a static (single-frame) indicator", () => {
		mock.timers.enable({ apis: ["setInterval", "Date"] });
		const loader = new Loader(fakeTui, id, id, "Working", { frames: ["●"] }, true);
		assert.ok(loader.render(40).join("").includes("(0s)"), "starts at (0s)");

		mock.timers.tick(3000);
		const out = loader.render(40).join("");
		assert.ok(!out.includes("(0s)"), "counter advances even without frame animation");
		assert.match(out, /\(\d+s\)/);
		loader.stop();
	});

	it("omits elapsed when disabled (default)", () => {
		mock.timers.enable({ apis: ["setInterval", "Date"] });
		const loader = new Loader(fakeTui, id, id, "Working");
		mock.timers.tick(3000);
		assert.doesNotMatch(loader.render(40).join(""), /\(\d+s\)/);
		loader.stop();
	});
});
