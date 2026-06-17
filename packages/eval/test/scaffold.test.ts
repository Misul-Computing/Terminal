import { describe, expect, it } from "vitest";
import { EVAL_PACKAGE_VERSION } from "../src/index.ts";

describe("scaffold", () => {
	it("exports the package version", () => {
		expect(EVAL_PACKAGE_VERSION).toBe("0.1.0");
	});
});
