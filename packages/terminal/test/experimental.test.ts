import { afterEach, describe, expect, it } from "vitest";
import { areExperimentalFeaturesEnabled } from "../src/core/experimental.ts";

describe("areExperimentalFeaturesEnabled", () => {
	const originalMisulExperimental = process.env.MISUL_EXPERIMENTAL;

	afterEach(() => {
		if (originalMisulExperimental === undefined) {
			delete process.env.MISUL_EXPERIMENTAL;
		} else {
			process.env.MISUL_EXPERIMENTAL = originalMisulExperimental;
		}
	});

	it("returns false when MISUL_EXPERIMENTAL is unset", () => {
		delete process.env.MISUL_EXPERIMENTAL;

		expect(areExperimentalFeaturesEnabled()).toBe(false);
	});

	it("returns false when MISUL_EXPERIMENTAL is empty", () => {
		process.env.MISUL_EXPERIMENTAL = "";

		expect(areExperimentalFeaturesEnabled()).toBe(false);
	});

	it("returns true when MISUL_EXPERIMENTAL is set to 1", () => {
		process.env.MISUL_EXPERIMENTAL = "1";

		expect(areExperimentalFeaturesEnabled()).toBe(true);
	});

	it("returns false when MISUL_EXPERIMENTAL is set to 0", () => {
		process.env.MISUL_EXPERIMENTAL = "0";

		expect(areExperimentalFeaturesEnabled()).toBe(false);
	});

	it("returns false when MISUL_EXPERIMENTAL is set to a non-1 value", () => {
		process.env.MISUL_EXPERIMENTAL = "true";

		expect(areExperimentalFeaturesEnabled()).toBe(false);
	});
});
