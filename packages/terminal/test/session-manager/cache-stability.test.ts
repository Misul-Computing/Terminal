/**
 * Cache stability tests for the compaction and message-history pipeline.
 *
 * Verifies that the cacheable prefix (compaction summaries, branch summaries,
 * and the serialized conversation used for summarization) is deterministic
 * across rebuilds. See docs/cache-aware-design.md for the determinism rules.
 */
import type { AgentMessage } from "@misul/agent-core";
import type { AssistantMessage, Message } from "@misul/ai";
import { describe, expect, it } from "vitest";
import { serializeConversation } from "../../src/core/compaction/utils.ts";
import {
	COMPACTION_SUMMARY_PREFIX,
	COMPACTION_SUMMARY_SUFFIX,
	BRANCH_SUMMARY_PREFIX,
	BRANCH_SUMMARY_SUFFIX,
	convertToLlm,
	createCompactionSummaryMessage,
	createBranchSummaryMessage,
} from "../../src/core/messages.ts";
import {
	buildSessionContext,
	type CompactionEntry,
	type BranchSummaryEntry,
	type SessionEntry,
	type SessionMessageEntry,
} from "../../src/core/session-manager.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function msg(id: string, parentId: string | null, role: "user" | "assistant", text: string): SessionMessageEntry {
	const base = { type: "message" as const, id, parentId, timestamp: "2025-01-01T00:00:00Z" };
	if (role === "user") {
		return { ...base, message: { role, content: text, timestamp: 1 } };
	}
	return {
		...base,
		message: {
			role,
			content: [{ type: "text", text }],
			api: "anthropic-messages",
			provider: "anthropic",
			model: "claude-test",
			usage: {
				input: 1,
				output: 1,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 2,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp: 1,
		} as AssistantMessage,
	};
}

function compaction(id: string, parentId: string | null, summary: string, firstKeptEntryId: string): CompactionEntry {
	return {
		type: "compaction",
		id,
		parentId,
		timestamp: "2025-01-01T00:00:00Z",
		summary,
		firstKeptEntryId,
		tokensBefore: 1000,
	};
}

function branchSummary(id: string, parentId: string | null, summary: string, fromId: string): BranchSummaryEntry {
	return { type: "branch_summary", id, parentId, timestamp: "2025-01-01T00:00:00Z", summary, fromId };
}

function assistantWithToolCall(
	id: string,
	parentId: string | null,
	toolName: string,
	args: Record<string, unknown>,
): SessionMessageEntry {
	return {
		type: "message",
		id,
		parentId,
		timestamp: "2025-01-01T00:00:00Z",
		message: {
			role: "assistant",
			content: [
				{ type: "text", text: "Let me check." },
				{ type: "toolCall", id: `tc-${id}`, name: toolName, arguments: args },
			],
			api: "anthropic-messages",
			provider: "anthropic",
			model: "claude-test",
			usage: {
				input: 1,
				output: 1,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 2,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "toolUse",
			timestamp: 1,
		} as AssistantMessage,
	};
}

// ---------------------------------------------------------------------------
// Compaction summary message determinism
// ---------------------------------------------------------------------------

describe("compaction summary cache stability", () => {
	it("compaction summary LLM content is deterministic across rebuilds", () => {
		const entries: SessionEntry[] = [
			msg("1", null, "user", "first"),
			msg("2", "1", "assistant", "response1"),
			compaction("5", "2", "Goal: fix bug. Done: found root cause.", "2"),
			msg("6", "5", "user", "third"),
		];

		const ctx1 = buildSessionContext(entries);
		const ctx2 = buildSessionContext(entries);

		// The compaction summary message must be byte-identical across rebuilds.
		const llm1 = convertToLlm(ctx1.messages);
		const llm2 = convertToLlm(ctx2.messages);

		expect(llm1).toEqual(llm2);

		// The first message is the compaction summary. Verify its text content
		// is exactly PREFIX + summary + SUFFIX with no timestamps or variable data.
		const summaryText1 = (llm1[0].content as { type: "text"; text: string }[])[0].text;
		const summaryText2 = (llm2[0].content as { type: "text"; text: string }[])[0].text;

		expect(summaryText1).toBe(summaryText2);
		expect(summaryText1).toBe(
			COMPACTION_SUMMARY_PREFIX + "Goal: fix bug. Done: found root cause." + COMPACTION_SUMMARY_SUFFIX,
		);
	});

	it("compaction summary content contains no timestamps or model names", () => {
		const summaryText = "Goal: fix bug. Done: found root cause.";
		const message = createCompactionSummaryMessage(summaryText, 5000, "2025-06-15T12:00:00Z");
		const llmMessages = convertToLlm([message]);
		const text = (llmMessages[0].content as { type: "text"; text: string }[])[0].text;

		// The timestamp must NOT appear in the LLM content text.
		expect(text).not.toContain("2025");
		expect(text).not.toContain("1718");
		// The tokensBefore must NOT appear in the LLM content text.
		expect(text).not.toContain("5000");
		// Only the prefix, summary, and suffix should be present.
		expect(text).toBe(COMPACTION_SUMMARY_PREFIX + summaryText + COMPACTION_SUMMARY_SUFFIX);
	});

	it("compaction epoch ID is stable across rebuilds", () => {
		const entries: SessionEntry[] = [
			msg("1", null, "user", "first"),
			msg("2", "1", "assistant", "response1"),
			compaction("5", "2", "Summary", "2"),
			msg("6", "5", "user", "third"),
		];

		const ctx1 = buildSessionContext(entries);
		const ctx2 = buildSessionContext(entries);

		expect(ctx1.compactionEpochId).toBe(ctx2.compactionEpochId);
		expect(ctx1.compactionEpochId).toBe("5");
	});
});

// ---------------------------------------------------------------------------
// Branch summary message determinism
// ---------------------------------------------------------------------------

describe("branch summary cache stability", () => {
	it("branch summary LLM content is deterministic across rebuilds", () => {
		const entries: SessionEntry[] = [
			msg("1", null, "user", "start"),
			msg("2", "1", "assistant", "response"),
			msg("3", "2", "user", "abandoned path"),
			branchSummary("4", "2", "Tried wrong approach", "3"),
			msg("5", "4", "user", "new direction"),
		];

		const ctx1 = buildSessionContext(entries, "5");
		const ctx2 = buildSessionContext(entries, "5");

		const llm1 = convertToLlm(ctx1.messages);
		const llm2 = convertToLlm(ctx2.messages);

		expect(llm1).toEqual(llm2);

		// The branch summary is the 3rd message (index 2).
		// Path from leaf 5: 5 -> 4(branch_summary) -> 2 -> 1 = 4 messages.
		const summaryText1 = (llm1[2].content as { type: "text"; text: string }[])[0].text;
		const summaryText2 = (llm2[2].content as { type: "text"; text: string }[])[0].text;

		expect(summaryText1).toBe(summaryText2);
		expect(summaryText1).toBe(
			BRANCH_SUMMARY_PREFIX + "Tried wrong approach" + BRANCH_SUMMARY_SUFFIX,
		);
	});

	it("branch summary content contains no timestamps", () => {
		const summaryText = "Explored alternative approach.";
		const message = createBranchSummaryMessage(summaryText, "abc", "2025-06-15T12:00:00Z");
		const llmMessages = convertToLlm([message]);
		const text = (llmMessages[0].content as { type: "text"; text: string }[])[0].text;

		expect(text).not.toContain("2025");
		expect(text).not.toContain("1718");
		expect(text).toBe(BRANCH_SUMMARY_PREFIX + summaryText + BRANCH_SUMMARY_SUFFIX);
	});
});

// ---------------------------------------------------------------------------
// serializeConversation determinism (summarization prompt input)
// ---------------------------------------------------------------------------

describe("serializeConversation cache stability", () => {
	it("tool call arguments are serialized with sorted keys regardless of insertion order", () => {
		// Two assistant messages with the same logical arguments but different
		// key insertion order. The serialized text must be identical.
		const argsOrderA = { path: "/foo", content: "bar", line: 10 };
		const argsOrderB = { line: 10, content: "bar", path: "/foo" };

		const makeMessages = (args: Record<string, unknown>): Message[] => {
			const assistantMsg: AssistantMessage = {
				role: "assistant",
				content: [
					{ type: "text", text: "Editing file." },
					{ type: "toolCall", id: "tc1", name: "edit", arguments: args },
				],
				api: "anthropic-messages",
				provider: "anthropic",
				model: "claude-test",
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason: "toolUse",
				timestamp: 1,
			};
			return [assistantMsg];
		};

		const textA = serializeConversation(makeMessages(argsOrderA));
		const textB = serializeConversation(makeMessages(argsOrderB));

		expect(textA).toBe(textB);
	});

	it("multiple tool calls in one message are serialized deterministically", () => {
		const args1 = { pattern: "foo", path: "/src" };
		const args2 = { path: "/dst", content: "result" };

		const assistantMsg: AssistantMessage = {
			role: "assistant",
			content: [
				{ type: "text", text: "Working." },
				{ type: "toolCall", id: "tc1", name: "grep", arguments: args1 },
				{ type: "toolCall", id: "tc2", name: "write", arguments: args2 },
			],
			api: "anthropic-messages",
			provider: "anthropic",
			model: "claude-test",
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "toolUse",
			timestamp: 1,
		};

		const text1 = serializeConversation([assistantMsg]);
		// Serialize again with the same input - must be identical.
		const text2 = serializeConversation([assistantMsg]);

		expect(text1).toBe(text2);
	});
});

// ---------------------------------------------------------------------------
// Full pipeline determinism: buildSessionContext -> convertToLlm
// ---------------------------------------------------------------------------

describe("full pipeline cache stability", () => {
	it("rebuilding context from the same entries produces identical LLM messages", () => {
		const entries: SessionEntry[] = [
			msg("1", null, "user", "first"),
			msg("2", "1", "assistant", "response1"),
			msg("3", "2", "user", "second"),
			msg("4", "3", "assistant", "response2"),
			compaction("5", "4", "Summary of first two turns", "3"),
			msg("6", "5", "user", "third"),
			msg("7", "6", "assistant", "response3"),
		];

		const ctx1 = buildSessionContext(entries);
		const ctx2 = buildSessionContext(entries);

		const llm1 = convertToLlm(ctx1.messages);
		const llm2 = convertToLlm(ctx2.messages);

		// Every message must be byte-identical. This is the property that
		// makes prompt caching work: if the prefix changes between turns,
		// the cache misses and every token is reprocessed.
		expect(llm1).toEqual(llm2);
	});

	it("context with branch summary produces identical LLM messages across rebuilds", () => {
		const entries: SessionEntry[] = [
			msg("1", null, "user", "start"),
			msg("2", "1", "assistant", "r1"),
			msg("3", "2", "user", "q2"),
			msg("4", "3", "assistant", "r2"),
			compaction("5", "4", "Compacted history", "3"),
			msg("6", "5", "user", "q3"),
			msg("7", "6", "assistant", "r3"),
			msg("8", "3", "user", "wrong path"),
			msg("9", "8", "assistant", "wrong response"),
			branchSummary("10", "3", "Tried wrong approach", "9"),
			msg("11", "10", "user", "better approach"),
		];

		const ctx1 = buildSessionContext(entries, "11");
		const ctx2 = buildSessionContext(entries, "11");

		const llm1 = convertToLlm(ctx1.messages);
		const llm2 = convertToLlm(ctx2.messages);

		expect(llm1).toEqual(llm2);
	});
});
