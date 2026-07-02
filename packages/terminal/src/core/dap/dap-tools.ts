// DAP tools for the agent. Exposes debug operations as agent tools
// so the model can set breakpoints, run code, inspect state, and step.
// The agent discovers runtime truth through these tools.

import { Type } from "typebox";
import type { AgentTool, AgentToolResult } from "@misul/agent-core";
import { DapClient, type Breakpoint, type Scope } from "./dap-client.ts";

interface DebugSession {
	id: string;
	client: DapClient;
	threadId: number;
}

// Session manager scoped to an agent instance, not module-global.
// One debug session at a time per agent.
export class DebugSessionManager {
	private _session: DebugSession | undefined;

	getSession(): DebugSession {
		if (!this._session) throw new Error("No active debug session. Use debug_launch first.");
		return this._session;
	}

	setSession(session: DebugSession): void {
		this._session = session;
	}

	async clear(): Promise<void> {
		if (this._session) {
			try {
				await this._session.client.disconnect();
			} finally {
				this._session = undefined;
			}
		}
	}
}

export function createDapTools(manager: DebugSessionManager): AgentTool[] {
	function getSession(): DebugSession {
		return manager.getSession();
	}

	const debugLaunchTool: AgentTool = {
		name: "debug_launch",
		label: "debug_launch",
		description:
			"Launch a debug session. Starts a debug adapter and runs the program with debugging enabled. " +
			"The program runs until it hits a breakpoint or completes. " +
			"Set breakpoints with debug_breakpoint after launching (the session must be active). " +
			"If the program stops at a breakpoint, use debug_stack and debug_variables to inspect state, " +
			"then debug_continue or debug_step to resume.",
		parameters: Type.Object({
			adapter: Type.String({ description: "The debug adapter command to run (e.g. 'js-debug-adapter', 'python -m debugpy.adapter')." }),
			adapterArgs: Type.Array(Type.String(), { description: "Arguments to pass to the debug adapter." }),
			config: Type.Object({}, { description: "DAP launch configuration. For Node.js: { type: 'node', program: 'path/to/file.js' }. For Python: { type: 'python', program: 'path/to/script.py' }.", additionalProperties: true }),
			cwd: Type.Optional(Type.String({ description: "Working directory for the debug session." })),
		}),
		executionMode: "sequential",
		async execute(_toolCallId, params): Promise<AgentToolResult<unknown>> {
			const args = params as { adapter: string; adapterArgs?: string[]; config: Record<string, unknown>; cwd?: string };
			await manager.clear();
			const client = new DapClient(args.adapter, args.adapterArgs ?? [], args.cwd);
			await client.start();
			// Set up the session before launch so the stopped handler can
			// safely access it. A stopped event can arrive during launch
			// (e.g. stop-on-entry), before launch() resolves.
			const session: DebugSession = { id: `debug_${Date.now()}`, client, threadId: 1 };
			manager.setSession(session);
			client.onEvent("stopped", (body) => {
				session.threadId = Number(body.threadId ?? session.threadId);
			});
			try {
				await client.launch(args.config);
			} catch (e) {
				await manager.clear();
				throw e;
			}
			return {
				content: [{ type: "text", text: `Debug session started. Program launched with config: ${JSON.stringify(args.config)}` }],
				details: { sessionId: session.id },
			};
		},
	};

	const debugBreakpointTool: AgentTool = {
		name: "debug_breakpoint",
		label: "debug_breakpoint",
		description: "Set breakpoints in a file. Replaces all existing breakpoints in that file. Requires an active debug session (run debug_launch first).",
		parameters: Type.Object({
			file: Type.String({ description: "Absolute path to the source file." }),
			breakpoints: Type.Array(
				Type.Object({
					line: Type.Number({ description: "Line number (1-based)." }),
					condition: Type.Optional(Type.String({ description: "Optional condition expression." })),
				}),
				{ description: "Breakpoints to set." },
			),
		}),
		executionMode: "sequential",
		async execute(_toolCallId, params): Promise<AgentToolResult<unknown>> {
			const args = params as { file: string; breakpoints: Breakpoint[] };
			const session = getSession();
			await session.client.setBreakpoints(args.file, args.breakpoints);
			return {
				content: [{ type: "text", text: `Set ${args.breakpoints.length} breakpoint(s) in ${args.file}` }],
				details: { count: args.breakpoints.length },
			};
		},
	};

	const debugStackTool: AgentTool = {
		name: "debug_stack",
		label: "debug_stack",
		description: "Get the current call stack. Only valid when the program is stopped at a breakpoint.",
		parameters: Type.Object({
			maxFrames: Type.Optional(Type.Number({ description: "Maximum number of frames to return. Default 50." })),
		}),
		executionMode: "sequential",
		async execute(_toolCallId, params): Promise<AgentToolResult<unknown>> {
			const session = getSession();
			const { maxFrames } = params as { maxFrames?: number };
			const frames = await session.client.stackTrace(session.threadId, maxFrames);
			const text = frames.map((f, i) =>
				`#${i} ${f.name} at ${f.source?.path ?? "?"}:${f.line}:${f.column}`
			).join("\n");
			return {
				content: [{ type: "text", text: text || "No stack frames available." }],
				details: { frames },
			};
		},
	};

	const debugVariablesTool: AgentTool = {
		name: "debug_variables",
		label: "debug_variables",
		description: "Inspect top-level variables in the current frame. Returns all top-level variables in all scopes. Objects and arrays show a reference number but are not expanded; use debug_evaluate to inspect nested values.",
		parameters: Type.Object({
			frameId: Type.Optional(Type.Number({ description: "Frame ID from debug_stack. Defaults to top frame." })),
		}),
		executionMode: "sequential",
		async execute(_toolCallId, params): Promise<AgentToolResult<unknown>> {
			const session = getSession();
			const { frameId } = params as { frameId?: number };
			let fid = frameId;
			if (fid === undefined) {
				const frames = await session.client.stackTrace(session.threadId, 1);
				if (frames.length === 0) {
					return { content: [{ type: "text", text: "No frames available to inspect." }], details: {} };
				}
				fid = frames[0].id;
			}
			const scopes: Scope[] = await session.client.scopes(fid);
			const lines: string[] = [];
			for (const scope of scopes) {
				if (scope.variablesReference === 0) continue;
				const vars = await session.client.variables(scope.variablesReference);
				lines.push(`### ${scope.name}`);
				for (const v of vars) {
					lines.push(`  ${v.name} = ${v.value}${v.type ? ` (${v.type})` : ""}`);
				}
			}
			return {
				content: [{ type: "text", text: lines.join("\n") || "No variables available." }],
				details: {},
			};
		},
	};

	const debugContinueTool: AgentTool = {
		name: "debug_continue",
		label: "debug_continue",
		description: "Resume execution from the current breakpoint. The program runs until the next breakpoint or completion.",
		parameters: Type.Object({}),
		executionMode: "sequential",
		async execute(_toolCallId): Promise<AgentToolResult<unknown>> {
			const session = getSession();
			await session.client.continue(session.threadId);
			return { content: [{ type: "text", text: "Execution resumed." }], details: {} };
		},
	};

	const debugStepTool: AgentTool = {
		name: "debug_step",
		label: "debug_step",
		description: "Step through code. direction: 'next' (step over), 'stepIn' (step into), 'stepOut' (step out of current function).",
		parameters: Type.Object({
			direction: Type.Union(
				[Type.Literal("next"), Type.Literal("stepIn"), Type.Literal("stepOut")],
				{ description: "Step direction." },
			),
		}),
		executionMode: "sequential",
		async execute(_toolCallId, params): Promise<AgentToolResult<unknown>> {
			const { direction } = params as { direction: "next" | "stepIn" | "stepOut" };
			const session = getSession();
			await session.client.step(session.threadId, direction);
			return { content: [{ type: "text", text: `Stepped ${direction}.` }], details: { direction } };
		},
	};

	const debugEvaluateTool: AgentTool = {
		name: "debug_evaluate",
		label: "debug_evaluate",
		description: "Evaluate an expression in the context of the current frame. Useful for inspecting computed values.",
		parameters: Type.Object({
			expression: Type.String({ description: "Expression to evaluate." }),
			frameId: Type.Optional(Type.Number({ description: "Frame ID from debug_stack. Defaults to top frame." })),
		}),
		executionMode: "sequential",
		async execute(_toolCallId, params): Promise<AgentToolResult<unknown>> {
			const { expression, frameId } = params as { expression: string; frameId?: number };
			const session = getSession();
			let fid = frameId;
			if (fid === undefined) {
				const frames = await session.client.stackTrace(session.threadId, 1);
				if (frames.length === 0) {
					return { content: [{ type: "text", text: "No frames available for evaluation." }], details: {} };
				}
				fid = frames[0].id;
			}
			const result = await session.client.evaluate(expression, fid);
			return { content: [{ type: "text", text: result }], details: { result } };
		},
	};

	const debugDisconnectTool: AgentTool = {
		name: "debug_disconnect",
		label: "debug_disconnect",
		description: "End the current debug session. Always call this when done debugging.",
		parameters: Type.Object({}),
		executionMode: "sequential",
		async execute(_toolCallId): Promise<AgentToolResult<unknown>> {
			await manager.clear();
			return { content: [{ type: "text", text: "Debug session ended." }], details: {} };
		},
	};

	return [
		debugLaunchTool,
		debugBreakpointTool,
		debugStackTool,
		debugVariablesTool,
		debugContinueTool,
		debugStepTool,
		debugEvaluateTool,
		debugDisconnectTool,
	];
}
