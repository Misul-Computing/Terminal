import {
	type AssistantMessage,
	type AssistantMessageEvent,
	type Context,
	EventStream,
	type Message,
	type Model,
	type Tool,
	type UserMessage,
} from "@misul/ai";
import { Type } from "typebox";
import { describe, expect, it, vi } from "vitest";
import { agentLoop, computeToolSetSignature } from "../src/agent-loop.ts";
import type { AgentContext, AgentEvent, AgentLoopConfig, AgentMessage, AgentTool } from "../src/types.ts";

class MockStream extends EventStream<AssistantMessageEvent, AssistantMessage> {
	constructor() {
		super(
			(e) => e.type === "done" || e.type === "error",
			(e) => (e.type === "done" ? e.message : e.type === "error" ? e.error : (() => { throw new Error("unexpected"); })()),
		);
	}
}

function usage() {
	return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
}

function model(): Model<"openai-responses"> {
	return { id: "mock", name: "mock", api: "openai-responses", provider: "openai", baseUrl: "https://example.invalid", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 8192, maxTokens: 2048 };
}

function userMsg(text: string): UserMessage {
	return { role: "user", content: text, timestamp: Date.now() };
}

function assistantMsg(text: string): AssistantMessage {
	return { role: "assistant", content: [{ type: "text", text }], api: "openai-responses", provider: "openai", model: "mock", usage: usage(), stopReason: "stop", timestamp: Date.now() };
}

function identityConverter(messages: AgentMessage[]): Message[] {
	return messages.filter((m) => m.role === "user" || m.role === "assistant" || m.role === "toolResult") as Message[];
}

function makeTool(name: string): AgentTool {
	return {
		name,
		description: `Tool ${name}`,
		parameters: Type.Object({}),
		execute: async () => ({ content: [], details: undefined }),
	};
}

describe("agentLoop tool sorting for cache stability", () => {
	it("passes tools to the stream function sorted by name", async () => {
		// Deliberately unsorted input.
		const tools: AgentTool[] = [
			makeTool("zebra"),
			makeTool("alpha"),
			makeTool("midnight"),
		];

		const context: AgentContext = {
			systemPrompt: "test",
			messages: [],
			tools,
		};

		const config: AgentLoopConfig = {
			model: model(),
			convertToLlm: identityConverter,
		};

		let capturedTools: AgentTool[] | undefined;

		const streamFn = (model: any, ctx: Context) => {
			capturedTools = ctx.tools;
			const stream = new MockStream();
			queueMicrotask(() => {
				stream.push({ type: "done", reason: "stop", message: assistantMsg("ok") });
			});
			return stream;
		};

		// Wrap streamSimple to capture the context.
		const events: AgentEvent[] = [];
		const stream = agentLoop([userMsg("hi")], context, config, undefined, streamFn);
		for await (const event of stream) {
			events.push(event);
		}
		await stream.result();

		// The agentLoop sorts tools before passing to the stream function.
		// Verify the actual tools array captured from the stream function call.
		expect(capturedTools).toBeDefined();
		expect(capturedTools!.map((t) => t.name)).toEqual(["alpha", "midnight", "zebra"]);
	});

	it("produces identical tool order regardless of input order", async () => {
		const toolsA: AgentTool[] = [makeTool("write"), makeTool("bash"), makeTool("read")];
		const toolsB: AgentTool[] = [makeTool("read"), makeTool("write"), makeTool("bash")];

		const sortFn = (tools: AgentTool[]) =>
			[...tools].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

		const sortedA = sortFn(toolsA).map((t) => t.name);
		const sortedB = sortFn(toolsB).map((t) => t.name);

		expect(sortedA).toEqual(sortedB);
		expect(sortedA).toEqual(["bash", "read", "write"]);
	});

	it("computeToolSetSignature is order-independent", () => {
		const toolsA: AgentTool[] = [makeTool("zebra"), makeTool("alpha"), makeTool("midnight")];
		const toolsB: AgentTool[] = [makeTool("alpha"), makeTool("midnight"), makeTool("zebra")];
		expect(computeToolSetSignature(toolsA)).toBe(computeToolSetSignature(toolsB));
	});

	it("computeToolSetSignature differs when tool set changes", () => {
		const toolsA: AgentTool[] = [makeTool("alpha"), makeTool("zebra")];
		const toolsB: AgentTool[] = [makeTool("alpha"), makeTool("beta")];
		expect(computeToolSetSignature(toolsA)).not.toBe(computeToolSetSignature(toolsB));
	});

	it("computeToolSetSignature handles empty and undefined", () => {
		expect(computeToolSetSignature(undefined)).toBe("");
		expect(computeToolSetSignature([])).toBe("");
	});

	it("warns when tool set changes mid-session via prepareNextTurn", async () => {
		const initialTools: AgentTool[] = [makeTool("alpha"), makeTool("zebra")];
		const updatedTools: AgentTool[] = [makeTool("alpha"), makeTool("beta")];

		const context: AgentContext = {
			systemPrompt: "test",
			messages: [],
			tools: initialTools,
		};

		let callIndex = 0;
		const streamFn = () => {
			const stream = new MockStream();
			queueMicrotask(() => {
				if (callIndex === 0) {
					// First call: return a tool call so the loop continues.
					stream.push({
						type: "done",
						reason: "toolUse",
						message: {
							role: "assistant",
							content: [{ type: "toolCall", id: "tc-1", name: "alpha", arguments: {} }],
							api: "openai-responses",
							provider: "openai",
							model: "mock",
							usage: usage(),
							stopReason: "toolUse",
							timestamp: Date.now(),
						} as AssistantMessage,
					});
				} else {
					stream.push({ type: "done", reason: "stop", message: assistantMsg("done") });
				}
				callIndex++;
			});
			return stream;
		};

		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		const config: AgentLoopConfig = {
			model: model(),
			convertToLlm: identityConverter,
			prepareNextTurn: ({ context: ctx }) => {
				// On the first turn, swap the tool set.
				if (callIndex === 1) {
					return {
						context: { ...ctx, tools: updatedTools },
					};
				}
				return undefined;
			},
		};

		const stream = agentLoop([userMsg("hi")], context, config, undefined, streamFn);
		for await (const _event of stream) {
			// drain
		}
		await stream.result();

		expect(warnSpy).toHaveBeenCalled();
		const warnMsg = warnSpy.mock.calls[0][0] as string;
		expect(warnMsg).toContain("Tool set changed");
		expect(warnMsg).toContain("beta");

		warnSpy.mockRestore();
	});

	it("does not warn when tool set stays the same across turns", async () => {
		const tools: AgentTool[] = [makeTool("alpha"), makeTool("zebra")];

		const context: AgentContext = {
			systemPrompt: "test",
			messages: [],
			tools,
		};

		let callIndex = 0;
		const streamFn = () => {
			const stream = new MockStream();
			queueMicrotask(() => {
				if (callIndex === 0) {
					stream.push({
						type: "done",
						reason: "toolUse",
						message: {
							role: "assistant",
							content: [{ type: "toolCall", id: "tc-1", name: "alpha", arguments: {} }],
							api: "openai-responses",
							provider: "openai",
							model: "mock",
							usage: usage(),
							stopReason: "toolUse",
							timestamp: Date.now(),
						} as AssistantMessage,
					});
				} else {
					stream.push({ type: "done", reason: "stop", message: assistantMsg("done") });
				}
				callIndex++;
			});
			return stream;
		};

		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		const config: AgentLoopConfig = {
			model: model(),
			convertToLlm: identityConverter,
			prepareNextTurn: ({ context: ctx }) => {
				// Return the same tool set (different array, same names).
				if (callIndex === 1) {
					return {
						context: { ...ctx, tools: [makeTool("alpha"), makeTool("zebra")] },
					};
				}
				return undefined;
			},
		};

		const stream = agentLoop([userMsg("hi")], context, config, undefined, streamFn);
		for await (const _event of stream) {
			// drain
		}
		await stream.result();

		expect(warnSpy).not.toHaveBeenCalled();

		warnSpy.mockRestore();
	});
});
