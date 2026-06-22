import type { AgentMessage } from "@misul/agent-core";
import { describe, expect, it } from "vitest";
import { buildSessionContext, type SessionEntry } from "../src/core/session-manager.ts";

// A persisted session file is a trust boundary: a corrupted/hand-edited file can
// contain a parentId cycle. The branch walk must not loop forever on it.
function messageEntry(id: string, parentId: string): SessionEntry {
	return {
		type: "message",
		id,
		parentId,
		timestamp: new Date().toISOString(),
		message: { role: "user", content: id, timestamp: Date.now() } as AgentMessage,
	} as unknown as SessionEntry;
}

describe("session tree cycle safety", () => {
	it("does not hang on a self-parent cycle", () => {
		const a = messageEntry("A", "A");
		const byId = new Map<string, SessionEntry>([["A", a]]);

		const ctx = buildSessionContext([a], "A", byId);

		expect(ctx.messages.length).toBe(1);
	});

	it("does not hang on a two-node parentId cycle", () => {
		const a = messageEntry("A", "B");
		const b = messageEntry("B", "A");
		const byId = new Map<string, SessionEntry>([
			["A", a],
			["B", b],
		]);

		const ctx = buildSessionContext([a, b], "A", byId);

		expect(ctx.messages.length).toBe(2);
	});
});
