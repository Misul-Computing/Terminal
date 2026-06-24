import { describe, expect, it } from "vitest";
import { getSupportedThinkingLevels } from "../src/models.ts";
import { getModels, getProviders } from "../src/models.ts";
import type { Api, Model } from "../src/types.ts";

function getAllModels(): Model<Api>[] {
	return getProviders().flatMap((provider) => getModels(provider) as Model<Api>[]);
}

// GLM-5.2 (z.ai and mirrors) only exposes high/max effort tiers. It does NOT
// support low or medium as distinct tiers, despite OpenCode treating all GLM as
// binary. This locks in the corrected catalog so a stale regeneration can't
// silently re-advertise low/medium.
describe("GLM-5.2 thinking levels", () => {
	it("exposes only off/high/max (not low/medium) for every GLM-5.2 catalog entry", () => {
		const glm52 = getAllModels().filter((m) => /glm-?5\.2/i.test(m.id));
		expect(glm52.length).toBeGreaterThan(0);

		for (const model of glm52) {
			const levels = getSupportedThinkingLevels(model);
			expect(levels, `${model.provider}/${model.id}`).not.toContain("low");
			expect(levels, `${model.provider}/${model.id}`).not.toContain("medium");
			expect(levels, `${model.provider}/${model.id}`).toContain("high");
			expect(levels, `${model.provider}/${model.id}`).toContain("max");
		}
	});
});
