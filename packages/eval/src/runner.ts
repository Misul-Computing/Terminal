/**
 * Integration core: drive the Misul agent headlessly over one fixture/seed in
 * an isolated run dir and capture real per-run cost + tokens.
 *
 * Cost is double-sourced: `getSessionStats()` is authoritative (used for the
 * `RunResult`), while the cherry-picked {@link AgentRunCollector} aggregates the
 * same per-message cost independently as a cross-check. A mismatch is flagged on
 * `errorMessage` (never silently dropped) but the authoritative figure wins. The
 * cross-check is tolerant: it only flags when BOTH costs are present and differ
 * beyond a small epsilon, and never throws on a missing/non-finite cost.
 *
 * The session is always aborted+disposed on every path (try/finally), so a
 * timeout never leaves the agent running.
 */

import type { AssistantMessage, Model } from "@misul/ai";
import type { AuthStorage, CreateAgentSessionResult, ModelRegistry } from "@misul/terminal";
import { createAgentSession, DefaultResourceLoader, getAgentDir, SessionManager } from "@misul/terminal";
import { trace } from "@opentelemetry/api";
import { recordChat } from "./cost-adapter.ts";
import { cleanupRunDir, cloneToRunDir } from "./isolation.ts";
import { AgentRunCollector } from "./run-collector.ts";
import type { EvalFixture, RunResult } from "./types.ts";

const DEFAULT_TOOLS = ["read", "write", "edit", "bash"];
const DEFAULT_AGENT_TIMEOUT_MS = 300000;
/** Relative cost mismatch above this fraction is flagged on the run. */
const COST_MISMATCH_TOLERANCE = 1e-6;

const tracer = trace.getTracer("@misul/eval");

export interface RunFixtureOptions {
	/**
	 * Trial index, NOT an RNG seed. pi-ai exposes no RNG seed, so this only
	 * disambiguates and labels repeated trials; it cannot make runs reproducible.
	 * Variation across trials comes solely from provider sampling nondeterminism.
	 */
	seed: number;
	/** Model to drive. Omit to let the SDK resolve the configured default. */
	model?: Model<string>;
	/** Tool allowlist. Falls back to fixture metadata, then the default set. */
	tools?: string[];
	/**
	 * Sampling temperature forwarded to the agent session (default: undefined =
	 * provider default). pi-ai exposes no RNG seed; a non-zero temperature is the
	 * only lever for trial-to-trial variation under a sampling provider.
	 */
	temperature?: number;
	/** Isolated agent config dir. Defaults to the SDK default (~/.pi/agent). */
	agentDir?: string;
	/** Hard cap on the agent prompt; on overrun the run is marked errored. */
	agentTimeoutMs?: number;
	/**
	 * Keep the cloned run dir in place after the run (default false). The CLI sets
	 * this so the grader can run against the produced edit, then cleans up itself.
	 * With the default, `runFixture` cleans its own run dir before returning so the
	 * public API does not leak temp dirs.
	 */
	keepRunDir?: boolean;
	/** Injected auth storage (offline faux tests). Defaults to the SDK default. */
	authStorage?: AuthStorage;
	/** Injected model registry (offline faux tests). Defaults to the SDK default. */
	modelRegistry?: ModelRegistry;
	/** Injected session factory (tests). Defaults to the real `createAgentSession`. */
	createSession?: typeof createAgentSession;
	/**
	 * Scaffolding A/B lever (REPLACE): when set, the run uses a resource loader whose
	 * system prompt is replaced wholesale by this override. Note this drops the
	 * auto-generated tools/guidelines sections, so it tests a full prompt rewrite.
	 * For an ADDITIVE test, prefer `appendSystemPrompt`.
	 */
	systemPromptOverride?: () => string;
	/**
	 * Scaffolding A/B lever (ADDITIVE): when set, this text is appended to the FULL
	 * default system prompt (after the tools + guidelines sections), so a baseline
	 * vs "default + extra guidance" variant can be compared fairly. This is the right
	 * lever for testing added workflow guidance (plan/verify/read-before-edit, etc.).
	 */
	appendSystemPrompt?: string;
}

export interface CostCrossCheckInput {
	/** Authoritative dollar cost from `getSessionStats()`. May be NaN if absent. */
	statsCost: number;
	/** Independently aggregated dollar cost from the collector. */
	collectedUsd: number;
	/** Whether the collector actually observed a provider-reported cost. */
	collectedCostAvailable: boolean;
}

/**
 * Decide whether to flag a cost cross-check mismatch. Tolerant by design: only
 * flags when BOTH costs are present (finite stats cost AND the collector saw a
 * cost) and they differ beyond a small relative epsilon. Never throws.
 */
export function costCrossCheckMessage(input: CostCrossCheckInput): string | undefined {
	const { statsCost, collectedUsd, collectedCostAvailable } = input;
	if (!collectedCostAvailable) return undefined;
	if (!Number.isFinite(statsCost)) return undefined;
	if (Math.abs(collectedUsd - statsCost) > COST_MISMATCH_TOLERANCE * Math.max(1, Math.abs(statsCost))) {
		return `cost mismatch: getSessionStats=${statsCost} collector=${collectedUsd}`;
	}
	return undefined;
}

export async function runFixture(fixture: EvalFixture, options: RunFixtureOptions): Promise<RunResult> {
	const runDir = cloneToRunDir(fixture, options.seed);
	const tools = options.tools ?? fixture.metadata.tools ?? DEFAULT_TOOLS;
	const agentTimeoutMs = options.agentTimeoutMs ?? DEFAULT_AGENT_TIMEOUT_MS;
	const createSession = options.createSession ?? createAgentSession;
	const start = Date.now();

	const collector = new AgentRunCollector();

	const base: RunResult = {
		fixtureId: fixture.id,
		seed: options.seed,
		costUsd: 0,
		tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		durationMs: 0,
		runDir,
		errored: false,
	};

	const result = await driveSession();
	if (!options.keepRunDir) cleanupRunDir(runDir);
	return result;

	async function driveSession(): Promise<RunResult> {
		// Scaffolding A/B: build a resource loader with the variant system prompt,
		// mirroring createAgentSession's own default construction (it skips its internal
		// loader when one is passed, so we reload it here ourselves).
		let resourceLoader: DefaultResourceLoader | undefined;
		if (options.systemPromptOverride || options.appendSystemPrompt) {
			const appendText = options.appendSystemPrompt;
			resourceLoader = new DefaultResourceLoader({
				cwd: runDir,
				agentDir: options.agentDir ?? getAgentDir(),
				...(options.systemPromptOverride ? { systemPromptOverride: options.systemPromptOverride } : {}),
				...(appendText ? { appendSystemPromptOverride: () => [appendText] } : {}),
			});
			await resourceLoader.reload();
		}

		let created: CreateAgentSessionResult;
		try {
			created = await createSession({
				cwd: runDir,
				...(options.model ? { model: options.model } : {}),
				...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
				...(options.agentDir ? { agentDir: options.agentDir } : {}),
				...(options.authStorage ? { authStorage: options.authStorage } : {}),
				...(options.modelRegistry ? { modelRegistry: options.modelRegistry } : {}),
				...(resourceLoader ? { resourceLoader } : {}),
				tools,
				sessionManager: SessionManager.inMemory(runDir),
			});
		} catch (err) {
			return {
				...base,
				durationMs: Date.now() - start,
				errored: true,
				errorMessage: err instanceof Error ? err.message : String(err),
			};
		}

		const { session } = created;
		try {
			const unsubscribe = session.subscribe((event) => {
				if (event.type !== "message_end") return;
				const message = event.message;
				if (!isAssistantMessage(message)) return;
				const span = tracer.startSpan("chat");
				recordChat(collector, span, message);
				span.end();
			});

			let timedOut = false;
			try {
				let timer: NodeJS.Timeout | undefined;
				const timeout = new Promise<never>((_resolve, reject) => {
					timer = setTimeout(() => {
						timedOut = true;
						reject(new Error(`agent prompt exceeded ${agentTimeoutMs}ms`));
					}, agentTimeoutMs);
				});
				try {
					await Promise.race([session.prompt(fixture.prompt), timeout]);
				} finally {
					if (timer) clearTimeout(timer);
				}
			} catch (err) {
				// On timeout, stop the still-running agent before returning.
				if (timedOut) await session.abort();
				return {
					...base,
					durationMs: Date.now() - start,
					errored: true,
					errorMessage: err instanceof Error ? err.message : String(err),
				};
			} finally {
				unsubscribe();
			}

			const stats = safeSessionStats(session);
			const collected = collector.snapshot({ stepCount: stats.assistantMessages });
			const collectedUsd = collected.summary.cost.estimatedUsd;
			const collectedCostAvailable = collected.summary.cost.unavailableReasons.length === 0;

			const errorMessage = costCrossCheckMessage({
				statsCost: stats.cost,
				collectedUsd,
				collectedCostAvailable,
			});

			const costUsd = Number.isFinite(stats.cost) ? stats.cost : collectedUsd;

			return {
				...base,
				costUsd,
				tokens: {
					input: stats.tokens.input,
					output: stats.tokens.output,
					cacheRead: stats.tokens.cacheRead,
					cacheWrite: stats.tokens.cacheWrite,
					total: stats.tokens.total,
				},
				durationMs: Date.now() - start,
				errored: false,
				...(errorMessage ? { errorMessage } : {}),
			};
		} catch (err) {
			return {
				...base,
				durationMs: Date.now() - start,
				errored: true,
				errorMessage: err instanceof Error ? err.message : String(err),
			};
		} finally {
			// dispose() aborts the agent and frees resources; always run it.
			session.dispose();
		}
	}
}

interface SafeSessionStats {
	cost: number;
	assistantMessages: number;
	tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
}

/**
 * `getSessionStats()` dereferences `usage.cost.total` per assistant message, so
 * a provider that omits `usage.cost` makes it throw. Guard so a missing cost
 * degrades to a non-finite `cost` rather than crashing the run.
 */
function safeSessionStats(session: { getSessionStats: () => SafeSessionStats }): SafeSessionStats {
	try {
		return session.getSessionStats();
	} catch {
		return {
			cost: Number.NaN,
			assistantMessages: 0,
			tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		};
	}
}

function isAssistantMessage(message: { role?: string }): message is AssistantMessage {
	return message.role === "assistant";
}
