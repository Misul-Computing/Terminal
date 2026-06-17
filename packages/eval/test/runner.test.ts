import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { fauxAssistantMessage, fauxToolCall } from "@misul/ai";
import { createAgentSession } from "@misul/coding-agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadFixtures } from "../src/fixtures.ts";
import { gradeRunDir } from "../src/grader.ts";
import { cleanupRunDir } from "../src/isolation.ts";
import { costCrossCheckMessage, runFixture } from "../src/runner.ts";
import { createFauxRig, type FauxRig } from "./faux-helpers.ts";

const fixturesRoot = fileURLToPath(new URL("../fixtures", import.meta.url));

const EXPECTED_MATH = ["export function add(a: number, b: number): number {", "\treturn a + b;", "}", ""].join("\n");

describe("runFixture (offline faux)", () => {
	let rig: FauxRig;
	const runDirs: string[] = [];

	beforeEach(() => {
		rig = createFauxRig();
	});

	afterEach(() => {
		rig.faux.unregister();
		for (const d of runDirs.splice(0)) cleanupRunDir(d);
	});

	it("captures cost and tokens, applies a write tool call, and the grader passes", async () => {
		const [fixture] = loadFixtures(fixturesRoot, { ids: ["01-add-return-type"] });

		// Script: step 1 writes the corrected file (toolUse), step 2 stops.
		rig.faux.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "src/math.ts", content: EXPECTED_MATH }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("Done.", { stopReason: "stop" }),
		]);

		const run = await runFixture(fixture, {
			seed: 1,
			model: rig.model,
			tools: ["write"],
			authStorage: rig.authStorage,
			modelRegistry: rig.modelRegistry,
			agentDir: rig.agentDir,
			// This test inspects + grades the run dir, so keep it.
			keepRunDir: true,
		});
		runDirs.push(run.runDir);

		expect(run.errored).toBe(false);
		expect(run.fixtureId).toBe("01-add-return-type");
		expect(run.seed).toBe(1);
		// Token capture works with the faux usage estimate.
		expect(run.tokens.total).toBeGreaterThan(0);
		expect(typeof run.costUsd).toBe("number");
		expect(Number.isFinite(run.costUsd)).toBe(true);
		// Cost double-source cross-check did not flag a mismatch.
		expect(run.errorMessage).toBeUndefined();

		// The write tool actually applied the edit in the isolated run dir.
		const produced = readFileSync(join(run.runDir, "src", "math.ts"), "utf8");
		expect(produced).toContain(": number");

		// And the deterministic grader passes on the produced edit.
		const grade = await gradeRunDir(run.runDir, fixture.metadata);
		expect(grade.score).toBe(1);
	});

	it("returns a finite cost even on an error turn", async () => {
		const [fixture] = loadFixtures(fixturesRoot, { ids: ["01-add-return-type"] });
		rig.faux.setResponses([fauxAssistantMessage("boom", { stopReason: "error", errorMessage: "scripted failure" })]);

		const run = await runFixture(fixture, {
			seed: 2,
			model: rig.model,
			tools: ["write"],
			authStorage: rig.authStorage,
			modelRegistry: rig.modelRegistry,
			agentDir: rig.agentDir,
		});
		runDirs.push(run.runDir);
		expect(run.fixtureId).toBe("01-add-return-type");
		expect(Number.isFinite(run.costUsd)).toBe(true);
	});

	it("forwards an explicit temperature into createAgentSession options", async () => {
		const [fixture] = loadFixtures(fixturesRoot, { ids: ["01-add-return-type"] });
		rig.faux.setResponses([fauxAssistantMessage("Done.", { stopReason: "stop" })]);

		let seenTemperature: number | undefined = -1; // sentinel: not invoked
		const spyCreateSession: typeof createAgentSession = (opts) => {
			seenTemperature = (opts as { temperature?: number }).temperature;
			return createAgentSession(opts);
		};

		const run = await runFixture(fixture, {
			seed: 7,
			model: rig.model,
			tools: ["write"],
			authStorage: rig.authStorage,
			modelRegistry: rig.modelRegistry,
			agentDir: rig.agentDir,
			temperature: 0.42,
			createSession: spyCreateSession,
		});
		runDirs.push(run.runDir);
		expect(seenTemperature).toBe(0.42);
	});

	it("omits temperature from createAgentSession options when not provided", async () => {
		const [fixture] = loadFixtures(fixturesRoot, { ids: ["01-add-return-type"] });
		rig.faux.setResponses([fauxAssistantMessage("Done.", { stopReason: "stop" })]);

		let hadTemperatureKey = true;
		const spyCreateSession: typeof createAgentSession = (opts) => {
			hadTemperatureKey = "temperature" in (opts as object);
			return createAgentSession(opts);
		};

		const run = await runFixture(fixture, {
			seed: 8,
			model: rig.model,
			tools: ["write"],
			authStorage: rig.authStorage,
			modelRegistry: rig.modelRegistry,
			agentDir: rig.agentDir,
			createSession: spyCreateSession,
		});
		runDirs.push(run.runDir);
		expect(hadTemperatureKey).toBe(false);
	});

	it("aborts and disposes the session on a timeout, returning errored", async () => {
		const [fixture] = loadFixtures(fixturesRoot, { ids: ["01-add-return-type"] });
		// A factory that resolves only once the stream's abort signal fires, so the
		// prompt never settles before the agent timeout, yet abort() can drive the
		// agent to idle (the real provider honors the abort signal the same way).
		rig.faux.setResponses([
			(_ctx, opts) =>
				new Promise((resolve) => {
					const signal = opts?.signal;
					const done = () => resolve(fauxAssistantMessage("aborted", { stopReason: "aborted" }));
					if (signal?.aborted) done();
					else signal?.addEventListener("abort", done, { once: true });
				}),
		]);

		let disposed = false;
		let aborted = false;
		const spyCreateSession: typeof createAgentSession = async (opts) => {
			const result = await createAgentSession(opts);
			const session = result.session;
			const realDispose = session.dispose.bind(session);
			const realAbort = session.abort.bind(session);
			session.dispose = () => {
				disposed = true;
				return realDispose();
			};
			session.abort = async () => {
				aborted = true;
				return realAbort();
			};
			return result;
		};

		const run = await runFixture(fixture, {
			seed: 9,
			model: rig.model,
			tools: ["write"],
			authStorage: rig.authStorage,
			modelRegistry: rig.modelRegistry,
			agentDir: rig.agentDir,
			agentTimeoutMs: 100,
			createSession: spyCreateSession,
		});
		runDirs.push(run.runDir);
		expect(run.errored).toBe(true);
		expect(run.errorMessage).toMatch(/exceeded/);
		expect(aborted).toBe(true);
		expect(disposed).toBe(true);
	});

	it("disposes the session on the happy path too", async () => {
		const [fixture] = loadFixtures(fixturesRoot, { ids: ["01-add-return-type"] });
		rig.faux.setResponses([fauxAssistantMessage("Done.", { stopReason: "stop" })]);

		let disposed = false;
		const spyCreateSession: typeof createAgentSession = async (opts) => {
			const result = await createAgentSession(opts);
			const session = result.session;
			const realDispose = session.dispose.bind(session);
			session.dispose = () => {
				disposed = true;
				return realDispose();
			};
			return result;
		};

		const run = await runFixture(fixture, {
			seed: 10,
			model: rig.model,
			tools: ["write"],
			authStorage: rig.authStorage,
			modelRegistry: rig.modelRegistry,
			agentDir: rig.agentDir,
			createSession: spyCreateSession,
		});
		runDirs.push(run.runDir);
		expect(run.errored).toBe(false);
		expect(disposed).toBe(true);
	});

	it("cleans its own runDir by default but keeps it with keepRunDir", async () => {
		const [fixture] = loadFixtures(fixturesRoot, { ids: ["01-add-return-type"] });

		// Default: runFixture cleans its own runDir.
		rig.faux.setResponses([fauxAssistantMessage("Done.", { stopReason: "stop" })]);
		const cleaned = await runFixture(fixture, {
			seed: 11,
			model: rig.model,
			tools: ["write"],
			authStorage: rig.authStorage,
			modelRegistry: rig.modelRegistry,
			agentDir: rig.agentDir,
		});
		expect(existsSync(cleaned.runDir)).toBe(false);

		// keepRunDir: the dir is left for the grader.
		rig.faux.setResponses([fauxAssistantMessage("Done.", { stopReason: "stop" })]);
		const kept = await runFixture(fixture, {
			seed: 12,
			model: rig.model,
			tools: ["write"],
			authStorage: rig.authStorage,
			modelRegistry: rig.modelRegistry,
			agentDir: rig.agentDir,
			keepRunDir: true,
		});
		runDirs.push(kept.runDir);
		expect(existsSync(kept.runDir)).toBe(true);
	});
});

describe("costCrossCheckMessage", () => {
	it("does not flag when costs match within epsilon", () => {
		expect(costCrossCheckMessage({ statsCost: 0.01, collectedUsd: 0.01, collectedCostAvailable: true })).toBeUndefined();
	});

	it("flags when both costs are present and differ beyond epsilon", () => {
		const msg = costCrossCheckMessage({ statsCost: 0.02, collectedUsd: 0.01, collectedCostAvailable: true });
		expect(msg).toMatch(/cost mismatch/);
	});

	it("does not flag (and does not throw) when the collector cost is unavailable", () => {
		// Provider omitted usage.cost.total -> collector saw no cost; never a false flag.
		expect(
			costCrossCheckMessage({ statsCost: 0.5, collectedUsd: 0, collectedCostAvailable: false }),
		).toBeUndefined();
	});

	it("does not flag when stats cost is not finite (missing/NaN)", () => {
		expect(
			costCrossCheckMessage({ statsCost: Number.NaN, collectedUsd: 0.01, collectedCostAvailable: true }),
		).toBeUndefined();
	});
});

describe("runFixture (live smoke)", () => {
	it.skipIf(!process.env.MISUL_EVAL_LIVE)("drives the real default model on one fixture", async () => {
		const [fixture] = loadFixtures(fixturesRoot, { ids: ["01-add-return-type"] });
		const run = await runFixture(fixture, { seed: 1 });
		const grade = await gradeRunDir(run.runDir, fixture.metadata);
		cleanupRunDir(run.runDir);
		expect(run.costUsd).toBeGreaterThan(0);
		expect([0, 1]).toContain(grade.score);
	});
});
