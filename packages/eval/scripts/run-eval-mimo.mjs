/**
 * Run the eval harness with mimo-v2.5 via opencode-go.
 * Usage: node run-eval-mimo.mjs
 */
import { getModel } from "@misul/ai";
import { AuthStorage, ModelRegistry } from "@misul/terminal";
import { runEvalCli } from "@misul/eval/cli";
import { join } from "node:path";
import { homedir } from "node:os";

const agentDir = join(homedir(), ".misul", "agent");
const authStorage = AuthStorage.create(join(agentDir, "auth.json"));
const modelRegistry = ModelRegistry.create(authStorage, join(agentDir, "models.json"));

const model = getModel("opencode-go", "mimo-v2.5");

const result = await runEvalCli({
	command: "run",
	seeds: 1,
	label: "mimo-v2.5",
	tools: ["read", "bash", "edit", "write"],
	model,
	authStorage,
	modelRegistry,
	agentDir,
});

if (result.kind === "run") {
	const r = result.report;
	console.log(`\n== ${r.label} ==`);
	console.log(`tasks=${r.tasksTotal} runs=${r.runsTotal} passed=${r.runsPassed}`);
	console.log(`meanScore=${r.meanScore.toFixed(3)} meanCost=$${r.meanCostUsd.toFixed(4)} totalCost=$${r.totalCostUsd.toFixed(4)}`);
	console.log(`QpD=${r.qpd.toFixed(3)} cost_of_pass=$${r.costOfPass.toFixed(4)}`);
	console.log(`meanOutTok=${r.meanOutputTokens.toFixed(0)} meanTotalTok=${r.meanTotalTokens.toFixed(0)}`);
}
