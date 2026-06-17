import { fauxAssistantMessage, fauxToolCall } from "@misul/ai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { formatReport, parseArgv, runEvalCli } from "../src/cli.ts";
import { createFauxRig, type FauxRig } from "./faux-helpers.ts";

const EXPECTED_MATH = ["export function add(a: number, b: number): number {", "\treturn a + b;", "}", ""].join("\n");

/** Queue: one write-tool turn applying the correct edit, then a stop turn. */
function scriptSolveMath(rig: FauxRig, repeats: number): void {
	const steps = [];
	for (let i = 0; i < repeats; i++) {
		steps.push(
			fauxAssistantMessage(fauxToolCall("write", { path: "src/math.ts", content: EXPECTED_MATH }), {
				stopReason: "toolUse" as const,
			}),
		);
		steps.push(fauxAssistantMessage("Done.", { stopReason: "stop" as const }));
	}
	rig.faux.setResponses(steps);
}

describe("parseArgv", () => {
	it("parses run with options", () => {
		const parsed = parseArgv([
			"run",
			"--seeds",
			"3",
			"--fixtures",
			"01-add-return-type,02-fix-null-guard",
			"--label",
			"x",
		]);
		expect(parsed.command).toBe("run");
		expect(parsed.seeds).toBe(3);
		expect(parsed.fixtureIds).toEqual(["01-add-return-type", "02-fix-null-guard"]);
		expect(parsed.label).toBe("x");
	});

	it("defaults seeds to 1 and command to run", () => {
		const parsed = parseArgv([]);
		expect(parsed.command).toBe("run");
		expect(parsed.seeds).toBe(1);
	});

	it("parses tools, variant-tools, variant-model, and variant-label", () => {
		const parsed = parseArgv([
			"compare",
			"--tools",
			"read,write",
			"--variant-tools",
			"read,write,bash",
			"--variant-model",
			"anthropic/claude-opus-4-5",
			"--variant-label",
			"with-bash",
		]);
		expect(parsed.command).toBe("compare");
		expect(parsed.tools).toEqual(["read", "write"]);
		expect(parsed.variantTools).toEqual(["read", "write", "bash"]);
		expect(parsed.variantModel).toBe("anthropic/claude-opus-4-5");
		expect(parsed.variantLabel).toBe("with-bash");
	});
});

describe("formatReport", () => {
	it("renders a human-readable QpD report", () => {
		const text = formatReport({
			label: "demo",
			runs: [],
			tasksTotal: 1,
			runsTotal: 2,
			meanScore: 0.5,
			meanCostUsd: 0.02,
			totalCostUsd: 0.04,
			runsPassed: 1,
			qpd: 25,
			costOfPass: 0.04,
		});
		expect(text).toContain("demo");
		expect(text).toContain("QpD");
	});
});

describe("runEvalCli (offline faux)", () => {
	let rig: FauxRig;
	beforeEach(() => {
		rig = createFauxRig();
	});
	afterEach(() => {
		rig.faux.unregister();
	});

	it("run: produces a QpD report with runsTotal = fixtures x seeds", async () => {
		// 1 fixture x 2 seeds = 2 runs, each needs a write+stop pair.
		scriptSolveMath(rig, 2);
		const result = await runEvalCli({
			command: "run",
			seeds: 2,
			fixtureIds: ["01-add-return-type"],
			tools: ["write"],
			model: rig.model,
			authStorage: rig.authStorage,
			modelRegistry: rig.modelRegistry,
			agentDir: rig.agentDir,
		});
		expect(result.kind).toBe("run");
		if (result.kind !== "run") throw new Error("expected run");
		expect(result.report.runsTotal).toBe(2);
		expect(result.report.tasksTotal).toBe(1);
		expect(result.report.runsPassed).toBe(2);
	});

	it("compare: returns equal-length baseline/variant and a boolean significance", async () => {
		// baseline + variant, each 1 fixture x 2 seeds, each run a write+stop pair.
		scriptSolveMath(rig, 4);
		const result = await runEvalCli({
			command: "compare",
			seeds: 2,
			fixtureIds: ["01-add-return-type"],
			tools: ["write"],
			variantTools: ["write"],
			model: rig.model,
			variantModel: rig.model,
			authStorage: rig.authStorage,
			modelRegistry: rig.modelRegistry,
			agentDir: rig.agentDir,
		});
		expect(result.kind).toBe("compare");
		if (result.kind !== "compare") throw new Error("expected compare");
		expect(result.report.baseline.runsTotal).toBe(result.report.variant.runsTotal);
		expect(result.report.baseline.runsTotal).toBe(2);
		expect(typeof result.report.significant).toBe("boolean");
	});

	it("compare: --variant-tools genuinely differs from --tools (different configs)", async () => {
		// Baseline gets the write tool and applies the fix (passes). Variant has NO
		// write tool, so the same scripted write call is unavailable -> it cannot fix
		// the file and the grader fails. Different pass counts prove the two reports
		// were built from genuinely different tool sets.
		scriptSolveMath(rig, 4);
		const result = await runEvalCli({
			command: "compare",
			seeds: 2,
			fixtureIds: ["01-add-return-type"],
			tools: ["write"],
			variantTools: [], // no tools at all
			variantLabel: "no-tools",
			model: rig.model,
			authStorage: rig.authStorage,
			modelRegistry: rig.modelRegistry,
			agentDir: rig.agentDir,
		});
		if (result.kind !== "compare") throw new Error("expected compare");
		expect(result.report.baseline.label).toBe("baseline");
		expect(result.report.variant.label).toBe("no-tools");
		expect(result.report.baseline.runsPassed).toBe(2);
		expect(result.report.variant.runsPassed).toBe(0);
	});
});
