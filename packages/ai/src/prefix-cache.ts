// Append-only context: compute a stable prefix hash from the LLM context
// so local providers (llama.cpp, ollama, laplace) can detect cache hits.
//
// Local providers maintain a KV-cache that is invalidated when the prompt
// prefix changes. By computing a hash of the stable prefix (system prompt
// + tools + all messages except the last), we can tell the provider exactly
// where the cacheable prefix ends. If the hash matches the previous call,
// the provider can reuse its KV-cache for everything up to that point.
//
// This module is provider-agnostic. Providers that support prefix caching
// read the prefixHash from the context metadata and compare it to their
// last-known hash. If they match, the prefix is cache-hot.

import { createHash } from "node:crypto";
import type { Context, Message, TextContent, ToolResultMessage } from "./types.ts";

/** Metadata key for the prefix hash in SimpleStreamOptions.env. */
export const PREFIX_HASH_KEY = "misul_prefix_hash";
/** Metadata key for the prefix length (in characters) in SimpleStreamOptions.env. */
export const PREFIX_LENGTH_KEY = "misul_prefix_length";

/**
 * Compute a SHA-256 hash of the stable prefix of an LLM context.
 * The stable prefix is: system prompt + tools + all messages except the last.
 * The last message is excluded because it changes every turn.
 */
export function computePrefixHash(context: Context): { hash: string; length: number } {
	const parts: string[] = [];

	if (context.systemPrompt) {
		parts.push(context.systemPrompt);
	}

	if (context.tools) {
		// Tools are already sorted by name by the agent loop.
		for (const tool of context.tools) {
			parts.push(tool.name);
			parts.push(JSON.stringify(tool.parameters ?? {}));
		}
	}

	// Include all messages except the last one in the stable prefix.
	// The last message is the new user input or tool result, which changes
	// every turn. Everything before it is append-only.
	const prefixMessages = context.messages.slice(0, -1);
	for (const msg of prefixMessages) {
		parts.push(messageToStableString(msg));
	}

	const joined = parts.join("\n");
	return {
		hash: createHash("sha256").update(joined, "utf8").digest("hex"),
		length: joined.length,
	};
}

/**
 * Convert a message to a stable string representation for hashing.
 * Excludes timestamps and other nondeterministic fields.
 */
function messageToStableString(msg: Message): string {
	const role = msg.role;
	const content = msg.content;

	if (role === "toolResult") {
		const tr = msg as ToolResultMessage;
		return `toolResult:${tr.toolCallId}:${JSON.stringify(tr.content)}`;
	}

	if (typeof content === "string") {
		return `${role}:${content}`;
	}

	if (Array.isArray(content)) {
		const parts = content.map((block) => {
			if (block.type === "text") {
				return `text:${(block as TextContent).text}`;
			}
			if (block.type === "toolCall") {
				const tc = block as { type: string; id: string; name: string; arguments: unknown };
				// Exclude the tool call ID from the stable string - it's
				// nondeterministic (contains timestamps/random). The name
				// and arguments are stable.
				return `toolCall:${tc.name}:${JSON.stringify(tc.arguments)}`;
			}
			if (block.type === "thinking") {
				const th = block as { type: string; thinking: string };
				return `thinking:${th.thinking}`;
			}
			return `${block.type}:${JSON.stringify(block)}`;
		});
		return `${role}:${parts.join("|")}`;
	}

	return `${role}:`;
}

/**
 * Inject prefix hash metadata into a stream options env object.
 * Local providers can read these to detect cache hits.
 */
export function injectPrefixHash(
	env: Record<string, string> | undefined,
	hash: string,
	length: number,
): Record<string, string> {
	return {
		...(env ?? {}),
		[PREFIX_HASH_KEY]: hash,
		[PREFIX_LENGTH_KEY]: String(length),
	};
}
