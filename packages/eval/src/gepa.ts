/**
 * GEPA-style reflective skill optimizer.
 *
 * Hill-climbing loop with LLM-informed mutations:
 * 1. Run the agent on eval fixtures with the current skill, capture traces.
 * 2. For failed fixtures, send the trace to a reflection LM.
 * 3. The LM diagnoses the failure and proposes a targeted skill edit.
 * 4. Apply the edit, re-run on the same fixtures.
 * 5. If the pass rate improves or stays equal with lower cost, keep. Else revert.
 *
 * No Pareto frontier, no population. Single-agent hill climb with reflective
 * mutation. The reflection LM sees full execution traces (Actionable Side
 * Information), not just pass/fail scores.
 */

import type { Model, Message } from "@misul/ai";
import { completeSimple } from "@misul/ai";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gradeRunDir } from "./grader.ts";
import { cleanupRunDir } from "./isolation.ts";
import { scoreRun } from "./metrics.ts";
import { runFixture } from "./runner.ts";
import type { EvalFixture, ScoredRun } from "./types.ts";

export interface GepaOptions {
	/** Skill file path (SKILL.md) to optimize. */
	skillPath: string;
	/** Fixtures to evaluate on. */
	fixtures: EvalFixture[];
	/** Model for the agent runs. */
	agentModel: Model<any>;
	/** Model for the reflection LM. Defaults to agentModel. */
	reflectionModel?: Model<any>;
	/** Max optimization iterations. Default 5. */
	maxIterations?: number;
	/** Seeds per fixture. Default 1. */
	seeds?: number;
	/** Tools for the agent. */
	tools?: string[];
	/** Auth storage (for offline tests). */
	authStorage?: import("@misul/terminal").AuthStorage;
	modelRegistry?: import("@misul/terminal").ModelRegistry;
}

export interface GepaIteration {
	iteration: number;
	passRate: number;
	meanCost: number;
	skillContent: string;
	mutation?: string;
	kept: boolean;
}

export interface GepaResult {
	iterations: GepaIteration[];
	finalSkill: string;
	improved: boolean;
}

const MAX_TRACE_CHARS = 8000;
const MAX_SKILL_CHARS = 16000;

export async function optimizeSkill(options: GepaOptions): Promise<GepaResult> {
	const maxIterations = options.maxIterations ?? 5;
	const seeds = options.seeds ?? 1;
	const reflectionModel = options.reflectionModel ?? options.agentModel;

	let skillContent = readFileSync(options.skillPath, "utf-8");
	const iterations: GepaIteration[] = [];

	// Baseline evaluation
	let currentRuns = await evaluateSkill(skillContent, options, seeds);
	let currentPassRate = passRate(currentRuns);
	let currentMeanCost = meanCost(currentRuns);
	iterations.push({
		iteration: 0,
		passRate: currentPassRate,
		meanCost: currentMeanCost,
		skillContent,
		kept: true,
	});

	console.log(`[gepa] baseline: ${currentPassRate.toFixed(2)} pass rate, $${currentMeanCost.toFixed(4)} mean cost`);

	for (let iter = 1; iter <= maxIterations; iter++) {
		// Find failed fixtures with traces
		const failures = currentRuns.filter((r) => r.score < 1);
		if (failures.length === 0) {
			console.log(`[gepa] iteration ${iter}: all fixtures pass, stopping.`);
			break;
		}

		// Build reflection prompt from failed traces
		const reflectionPrompt = buildReflectionPrompt(skillContent, failures);
		const mutation = await reflectAndMutate(reflectionModel, reflectionPrompt);
		if (!mutation) {
			console.log(`[gepa] iteration ${iter}: no mutation proposed, stopping.`);
			break;
		}

		// Apply mutation
		const newSkill = applyMutation(skillContent, mutation);
		if (!newSkill || newSkill.length > MAX_SKILL_CHARS) {
			console.log(`[gepa] iteration ${iter}: mutation rejected (invalid or too large).`);
			continue;
		}

		// Evaluate mutated skill
		const variantRuns = await evaluateSkill(newSkill, options, seeds);
		const variantPassRate = passRate(variantRuns);
		const variantMeanCost = meanCost(variantRuns);

		const improved = variantPassRate > currentPassRate ||
			(variantPassRate === currentPassRate && variantMeanCost < currentMeanCost);

		if (improved) {
			skillContent = newSkill;
			currentRuns = variantRuns;
			currentPassRate = variantPassRate;
			currentMeanCost = variantMeanCost;
			writeFileSync(options.skillPath, newSkill);
			console.log(`[gepa] iteration ${iter}: KEPT (pass: ${variantPassRate.toFixed(2)}, cost: $${variantMeanCost.toFixed(4)})`);
			iterations.push({
				iteration: iter,
				passRate: variantPassRate,
				meanCost: variantMeanCost,
				skillContent: newSkill,
				mutation,
				kept: true,
			});
		} else {
			console.log(`[gepa] iteration ${iter}: REVERTED (pass: ${variantPassRate.toFixed(2)}, cost: $${variantMeanCost.toFixed(4)})`);
			iterations.push({
				iteration: iter,
				passRate: variantPassRate,
				meanCost: variantMeanCost,
				skillContent: newSkill,
				mutation,
				kept: false,
			});
		}
	}

	return {
		iterations,
		finalSkill: skillContent,
		improved: iterations.some((i) => i.kept && i.iteration > 0),
	};
}

interface TraceRun extends ScoredRun {
	trace: string;
}

async function evaluateSkill(
	skillContent: string,
	options: GepaOptions,
	seeds: number,
): Promise<TraceRun[]> {
	const results: TraceRun[] = [];

	for (const fixture of options.fixtures) {
		for (let seed = 0; seed < seeds; seed++) {
			const trace = await captureTrace(fixture, skillContent, options, seed);
			results.push(trace);
		}
	}

	return results;
}

async function captureTrace(
	fixture: EvalFixture,
	skillContent: string,
	options: GepaOptions,
	seed: number,
): Promise<TraceRun> {
	// Run the agent with the skill appended to the system prompt.
	// The skill content is injected as appendSystemPrompt so it adds to the
	// default prompt without replacing it.
	const run = await runFixture(fixture, {
		seed,
		model: options.agentModel,
		tools: options.tools,
		appendSystemPrompt: skillContent,
		keepRunDir: true,
		...(options.authStorage ? { authStorage: options.authStorage } : {}),
		...(options.modelRegistry ? { modelRegistry: options.modelRegistry } : {}),
	});

	// Grade the run
	const grade = await gradeRunDir(run.runDir, fixture.metadata, fixture.inputDir);
	cleanupRunDir(run.runDir);

	const scored = scoreRun(run, grade.score);

	// Capture trace from session messages (the runner doesn't expose messages,
	// so we reconstruct from the run result + grade output).
	// ponytail: trace is the fixture prompt + grade output. Full conversation
	// capture would require patching the runner; this is sufficient for
	// reflection since the grade output tells the LM what went wrong.
	const trace = `Fixture: ${fixture.id}\nPrompt: ${fixture.prompt}\n\nResult: ${grade.score >= 1 ? "PASS" : "FAIL"}\n${grade.stdout.slice(0, MAX_TRACE_CHARS)}`;

	return { ...scored, trace };
}

function buildReflectionPrompt(skillContent: string, failures: TraceRun[]): string {
	const failureDescriptions = failures
		.map((f, i) => `### Failure ${i + 1}: ${f.fixtureId}\n${f.trace}`)
		.join("\n\n");

	return `You are optimizing a skill prompt. The skill is shown below, followed by execution traces where the agent FAILED.

## Current Skill
${skillContent}

## Failed Executions
${failureDescriptions}

## Task
Diagnose why the skill failed on these cases. Then propose a TARGETED improvement to the skill text that addresses the root cause.

Rules:
- Output the COMPLETE new skill text (with frontmatter).
- Keep the same name and description unless the failure was caused by a misleading description.
- Focus on the specific failure mode, not general improvements.
- Don't add more than 500 characters of new content.`;
}

async function reflectAndMutate(model: Model<any>, prompt: string): Promise<string | null> {
	try {
		const messages: Message[] = [{ role: "user", content: prompt, timestamp: Date.now() }];
		const response = await completeSimple(model, { messages });
		const text = response.content
			.filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
			.map((b) => b.text)
			.join("\n")
			.trim();
		return text || null;
	} catch (err) {
		console.error(`[gepa] reflection failed: ${err instanceof Error ? err.message : String(err)}`);
		return null;
	}
}

function applyMutation(currentSkill: string, mutation: string): string | null {
	// The mutation should be the complete new skill text.
	// Validate: must have frontmatter with name and description.
	if (!mutation.startsWith("---")) return null;
	const frontmatterEnd = mutation.indexOf("\n---", 3);
	if (frontmatterEnd === -1) return null;
	const frontmatter = mutation.slice(3, frontmatterEnd);
	if (!frontmatter.includes("name:") || !frontmatter.includes("description:")) return null;
	return mutation.trim() + "\n";
}

function passRate(runs: ScoredRun[]): number {
	if (runs.length === 0) return 0;
	return runs.filter((r) => r.score >= 1).length / runs.length;
}

function meanCost(runs: ScoredRun[]): number {
	if (runs.length === 0) return 0;
	return runs.reduce((sum, r) => sum + r.costUsd, 0) / runs.length;
}
