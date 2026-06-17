import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerFauxProvider } from "@misul/ai";
import { fauxAssistantMessage } from "@misul/ai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuthStorage } from "../../src/core/auth-storage.ts";
import { ModelRegistry } from "../../src/core/model-registry.ts";
import { createAgentSession } from "../../src/core/sdk.ts";
import { runSubagent } from "../../src/core/subagent/runner.ts";
import { SIMPLE } from "../../src/core/subagent/presets.ts";

interface FauxRig {
	faux: ReturnType<typeof registerFauxProvider>;
	authStorage: AuthStorage;
	modelRegistry: ModelRegistry;
	model: ReturnType<ReturnType<typeof registerFauxProvider>["getModel"]>;
	/** Isolated empty agent dir so child sessions skip real ~/.pi/agent extension discovery (perf bug P10). */
	agentDir: string;
}

function createFauxRig(): FauxRig {
	const agentDir = mkdtempSync(join(tmpdir(), "subagent-faux-agent-"));
	const faux = registerFauxProvider({
		models: [{ id: "faux-1", cost: { input: 0.000001, output: 0.000002, cacheRead: 0, cacheWrite: 0 } }],
	});
	const model = faux.getModel();
	const authStorage = AuthStorage.inMemory();
	authStorage.setRuntimeApiKey(model.provider, "faux-key");
	const modelRegistry = ModelRegistry.inMemory(authStorage);
	modelRegistry.registerProvider(model.provider, {
		baseUrl: model.baseUrl,
		apiKey: "faux-key",
		api: faux.api,
		models: faux.models.map((m) => ({
			id: m.id,
			name: m.name,
			api: m.api,
			reasoning: m.reasoning,
			input: m.input,
			cost: m.cost,
			contextWindow: m.contextWindow,
			maxTokens: m.maxTokens,
			baseUrl: m.baseUrl,
		})),
	});
	return { faux, authStorage, modelRegistry, model, agentDir };
}

describe("runSubagent (offline faux)", () => {
	let rig: FauxRig;

	beforeEach(() => {
		rig = createFauxRig();
	});

	afterEach(() => {
		rig.faux.unregister();
	});

	it("runs the inherited model, captures final text + finite cost, and disposes", async () => {
		rig.faux.setResponses([fauxAssistantMessage("subagent done.", { stopReason: "stop" })]);

		let disposed = false;
		let seenModelId: string | undefined;
		const spyCreateSession: typeof createAgentSession = async (opts) => {
			seenModelId = (opts as { model?: { id?: string } }).model?.id;
			const result = await createAgentSession(opts);
			const realDispose = result.session.dispose.bind(result.session);
			result.session.dispose = () => {
				disposed = true;
				return realDispose();
			};
			return result;
		};

		const result = await runSubagent({
			preset: SIMPLE,
			task: "do the thing",
			model: rig.model,
			cwd: process.cwd(),
			authStorage: rig.authStorage,
			modelRegistry: rig.modelRegistry,
			agentDir: rig.agentDir,
			createSession: spyCreateSession,
		});

		expect(result.errored).toBe(false);
		expect(result.output).toBe("subagent done.");
		expect(seenModelId).toBe(rig.model.id);
		expect(Number.isFinite(result.costUsd)).toBe(true);
		expect(result.tokens.total).toBeGreaterThan(0);
		expect(result.phases).toEqual(["execute"]);
		expect(disposed).toBe(true);
	}, 60000);

	it("RECURSION GUARD: the child session does not expose spawn_agent", async () => {
		rig.faux.setResponses([fauxAssistantMessage("done.", { stopReason: "stop" })]);

		let childToolNames: string[] = [];
		const spyCreateSession: typeof createAgentSession = async (opts) => {
			const result = await createAgentSession(opts);
			childToolNames = result.session.getAllTools().map((tool) => tool.name);
			return result;
		};

		const result = await runSubagent({
			preset: SIMPLE,
			task: "no recursion",
			model: rig.model,
			cwd: process.cwd(),
			authStorage: rig.authStorage,
			modelRegistry: rig.modelRegistry,
			agentDir: rig.agentDir,
			createSession: spyCreateSession,
		});

		expect(result.errored).toBe(false);
		expect(childToolNames).not.toContain("spawn_agent");
	}, 60000);

	it("aborts and disposes on timeout, returning errored", async () => {
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
			const realDispose = result.session.dispose.bind(result.session);
			const realAbort = result.session.abort.bind(result.session);
			result.session.dispose = () => {
				disposed = true;
				return realDispose();
			};
			result.session.abort = async () => {
				aborted = true;
				return realAbort();
			};
			return result;
		};

		const result = await runSubagent({
			preset: SIMPLE,
			task: "hang",
			model: rig.model,
			cwd: process.cwd(),
			authStorage: rig.authStorage,
			modelRegistry: rig.modelRegistry,
			agentDir: rig.agentDir,
			timeoutMs: 100,
			createSession: spyCreateSession,
		});

		expect(result.errored).toBe(true);
		expect(result.errorMessage).toMatch(/exceeded/);
		expect(aborted).toBe(true);
		expect(disposed).toBe(true);
	}, 60000);

	it("#7: a throwing abort during parent-abort does not become an unhandled rejection", async () => {
		// The faux prompt resolves only once its own signal aborts (driven by session.abort()).
		rig.faux.setResponses([
			(_ctx, opts) =>
				new Promise((resolve) => {
					const signal = opts?.signal;
					const done = () => resolve(fauxAssistantMessage("aborted", { stopReason: "aborted" }));
					if (signal?.aborted) done();
					else signal?.addEventListener("abort", done, { once: true });
				}),
		]);

		const rejections: unknown[] = [];
		const onRejection = (reason: unknown) => rejections.push(reason);
		process.on("unhandledRejection", onRejection);

		// Parent abort handler invokes session.abort(); make abort reject to exercise the catch.
		const spyCreateSession: typeof createAgentSession = async (opts) => {
			const result = await createAgentSession(opts);
			const realAbort = result.session.abort.bind(result.session);
			result.session.abort = async () => {
				await realAbort();
				throw new Error("abort blew up");
			};
			return result;
		};

		const parentController = new AbortController();
		const runPromise = runSubagent({
			preset: SIMPLE,
			task: "abort throws",
			model: rig.model,
			cwd: process.cwd(),
			authStorage: rig.authStorage,
			modelRegistry: rig.modelRegistry,
			agentDir: rig.agentDir,
			signal: parentController.signal,
			createSession: spyCreateSession,
		});
		// Abort the parent shortly after the prompt is in flight.
		setTimeout(() => parentController.abort(), 50);

		const result = await runPromise;
		// Give the microtask/event loop a tick to surface any unhandled rejection.
		await new Promise((r) => setTimeout(r, 50));
		process.off("unhandledRejection", onRejection);

		expect(result.errored).toBe(true);
		expect(rejections).toEqual([]);
	}, 60000);

	it("honors a pre-aborted parent signal", async () => {
		rig.faux.setResponses([
			(_ctx, opts) =>
				new Promise((resolve) => {
					const signal = opts?.signal;
					const done = () => resolve(fauxAssistantMessage("aborted", { stopReason: "aborted" }));
					if (signal?.aborted) done();
					else signal?.addEventListener("abort", done, { once: true });
				}),
		]);

		const parentController = new AbortController();
		parentController.abort();

		const result = await runSubagent({
			preset: SIMPLE,
			task: "parent already aborted",
			model: rig.model,
			cwd: process.cwd(),
			authStorage: rig.authStorage,
			modelRegistry: rig.modelRegistry,
			agentDir: rig.agentDir,
			signal: parentController.signal,
		});

		expect(result.errored).toBe(true);
	}, 60000);
});
