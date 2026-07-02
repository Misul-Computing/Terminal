import type { AgentToolResult } from "@misul/agent-core";
import { type Static, Type } from "typebox";
import { defineTool, type ToolDefinition } from "../extensions/types.ts";
import type { MemoryStore } from "../memory/index.ts";

const memoryWriteSchema = Type.Object({
	kind: Type.Union(
		[Type.Literal("convention"), Type.Literal("lesson"), Type.Literal("fact"), Type.Literal("decision")],
		{ description: "Memory kind: convention, lesson, fact, or decision." },
	),
	content: Type.String({ description: "The memory content to store. Keep it concise and factual." }),
	tags: Type.Optional(
		Type.String({ description: "Optional comma-separated tags for later search." }),
	),
	source: Type.Optional(
		Type.String({ description: "Optional source reference (file path, URL, etc.)." }),
	),
});

type MemoryWriteParams = Static<typeof memoryWriteSchema>;

export interface CreateMemoryWriteToolOptions {
	getMemoryStore: () => MemoryStore | undefined;
}

export function createMemoryWriteTool(options: CreateMemoryWriteToolOptions): ToolDefinition {
	return defineTool({
		name: "memory_write",
		label: "Save Memory",
		description:
			"Store a durable memory (convention, lesson, fact, or decision) for this project. " +
			"Memories persist across sessions and are loaded into the system prompt. " +
			"Use for project conventions, lessons learned, or important facts - not conversation history.",
		promptSnippet: "memory_write(kind, content, tags?, source?): save a durable project memory.",
		executionMode: "parallel",
		parameters: memoryWriteSchema,
		execute: async (_id, params: MemoryWriteParams): Promise<AgentToolResult<undefined>> => {
			const store = options.getMemoryStore();
			if (!store) {
				return textResult("Error: memory store is not available yet. Try again in a moment.");
			}
			try {
				const entry = await store.add({
					kind: params.kind,
					content: params.content,
					tags: params.tags,
					source: params.source,
				});
				return textResult(`Saved ${params.kind} memory #${entry.id}: ${params.content.slice(0, 80)}`);
			} catch (err) {
				return textResult(`Error saving memory: ${err instanceof Error ? err.message : String(err)}`);
			}
		},
	});
}

function textResult(text: string): AgentToolResult<undefined> {
	return { content: [{ type: "text", text }], details: undefined };
}
