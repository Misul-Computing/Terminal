import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadFixtures, runFixture } from "../src/index.ts";

const FIXTURES_ROOT = fileURLToPath(new URL("../fixtures", import.meta.url));

// Minimal fake agent session: runFixture only uses subscribe/prompt/getSessionStats/
// dispose/abort, so this lets us verify the scaffolding wiring with no model calls.
function fakeSession() {
	return {
		subscribe: () => () => {},
		prompt: async () => {},
		getSessionStats: () => ({
			cost: 0,
			assistantMessages: 0,
			tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		}),
		dispose: () => {},
		abort: async () => {},
	};
}

describe("scaffolding systemPromptOverride wiring", () => {
	it("propagates the variant system prompt to the agent session", async () => {
		const [fixture] = loadFixtures(FIXTURES_ROOT, { ids: ["01-add-return-type"] });
		expect(fixture).toBeDefined();

		const OVERRIDE = "VARIANT-PROMPT-SENTINEL-12345";
		let capturedPrompt: string | undefined;
		const createSession = (async (opts: { resourceLoader?: { getSystemPrompt(): string | undefined } }) => {
			capturedPrompt = opts.resourceLoader?.getSystemPrompt();
			return { session: fakeSession() };
		}) as never;

		const run = await runFixture(fixture, { seed: 1, systemPromptOverride: () => OVERRIDE, createSession });

		expect(run.errored).toBe(false);
		expect(capturedPrompt).toBe(OVERRIDE);
	});

	it("passes no resource loader for the baseline (default production prompt)", async () => {
		const [fixture] = loadFixtures(FIXTURES_ROOT, { ids: ["01-add-return-type"] });
		let resourceLoaderDefined = true;
		const createSession = (async (opts: { resourceLoader?: unknown }) => {
			resourceLoaderDefined = opts.resourceLoader !== undefined;
			return { session: fakeSession() };
		}) as never;

		await runFixture(fixture, { seed: 1, createSession });

		expect(resourceLoaderDefined).toBe(false);
	});
});
