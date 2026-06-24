// TEMP: run the QpD eval over given fixtures with the free MiMo V2.5 model.
// The free model is provider "opencode" (opencode.ai/zen/v1, cost 0); the user's key
// is stored as "opencode-go" in ~/.misul/agent. Both are the same OpenCode zen backend,
// so we load that auth and override "opencode" with the same key (in-memory, not persisted).
// Usage: tsx _run-mimo.ts [fixtureId...]
import { homedir } from "node:os";
import { join } from "node:path";
import { AuthStorage, ModelRegistry } from "@misul/terminal";
import { formatAbReport, formatReport, runEvalCli } from "../src/index.ts";

const agentDir = join(homedir(), ".misul", "agent");
const authStorage = AuthStorage.create(join(agentDir, "auth.json"));
const goKey = await authStorage.getApiKey("opencode-go");
if (!goKey) {
	console.error("no opencode-go key in ~/.misul/agent/auth.json");
	process.exit(1);
}
authStorage.setRuntimeApiKey("opencode", goKey);
const modelRegistry = ModelRegistry.create(authStorage);
const MODEL_ID = process.env.MODEL || "mimo-v2.5-free";
const model = modelRegistry.find("opencode", MODEL_ID);
if (!model) {
	console.error(`${MODEL_ID} not found in registry`);
	process.exit(1);
}

const seeds = Number(process.env.SEEDS) || 1;

// Engineering-workflow guidance (ADDITIVE A/B variant). Drawn from the competitor-
// harness research: classify-before-act, read-before-edit, surgical edits, brief
// planning, and verify-before-finish, none of which the baseline prompt contains.
const WORKFLOW_GUIDANCE = `## engineering_workflow

Before using any tool, classify the request: DIAGNOSTIC (the user wants an explanation, analysis, or options; do not modify files) or IMPLEMENTATION (the user wants changes made, so proceed). When it is ambiguous, ask before editing.

For implementation work, read the relevant files before editing them; never edit code you have not opened. Make the smallest change that satisfies the request and do not alter unrelated code. For a task with several steps, plan the steps briefly first and keep track of which remain.

Before reporting a task complete, verify it: run the project's tests or type-check if one is available, and confirm only the intended files changed. If a check fails, fix it and re-verify rather than reporting done; if the same failure persists after a few attempts, stop and report what you tried.`;

// First CLI arg may be "compare" to A/B the default prompt vs the default prompt PLUS
// the engineering-workflow guidance (additive). Compares pass rate AND output-token
// efficiency (the meaningful signal at $0 cost / ceiling pass rate).
const args = process.argv.slice(2);
const doCompare = args[0] === "compare";
const fixtureIds = (doCompare ? args.slice(1) : args).filter(Boolean);

if (doCompare) {
	const result = await runEvalCli({
		command: "compare",
		model: model as never,
		seeds,
		fixtureIds: fixtureIds.length ? fixtureIds : undefined,
		label: "baseline",
		variantLabel: "with-workflow",
		variantAppendSystemPrompt: WORKFLOW_GUIDANCE,
		authStorage,
		modelRegistry,
		agentDir,
	});
	if (result.kind === "compare") console.log(formatAbReport(result.report));
} else {
	const result = await runEvalCli({
		command: "run",
		model: model as never,
		seeds,
		fixtureIds: fixtureIds.length ? fixtureIds : undefined,
		label: MODEL_ID,
		authStorage,
		modelRegistry,
		agentDir,
	});
	if (result.kind === "run") {
		console.log(formatReport(result.report));
		for (const r of result.report.runs) {
			console.log(`  ${r.fixtureId} seed=${r.seed} score=${r.score} cost=$${r.costUsd} tok=${r.tokens.total}(in${r.tokens.input}/out${r.tokens.output}) ${r.errored ? `ERR: ${r.errorMessage}` : ""}`);
		}
	}
}
