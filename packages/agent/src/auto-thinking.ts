import type { Context, Model, TextContent, ThinkingLevel as AiThinkingLevel } from "@misul/ai";
import type { StreamFn } from "./types.ts";
import { redactString } from "./secret-redactor.ts";

const CLASSIFY_LEVELS: AiThinkingLevel[] = ["minimal", "low", "medium", "high"];

const CLASSIFY_PROMPT = `Classify the reasoning effort needed for this prompt. Reply with exactly one word: minimal, low, medium, or high.
- minimal: greetings, yes/no, acknowledgments, one-word answers
- low: straightforward lookups, simple edits, formatting
- medium: normal coding tasks, debugging, multi-step instructions
- high: complex architecture, algorithmic design, deep debugging, multi-system reasoning`;

/**
 * Classify the reasoning effort needed for the latest user message.
 * Returns a concrete ThinkingLevel (never "auto" or "off").
 *
 * Uses a lightweight model call with minimal tokens. Falls back to "medium"
 * on any error or if the response is unparseable.
 */
export async function classifyThinkingLevel(
	model: Model<any>,
	messages: { role: string; content: unknown }[],
	streamFn: StreamFn,
	signal?: AbortSignal,
): Promise<AiThinkingLevel> {
	const lastUser = [...messages].reverse().find((m) => m.role === "user");
	if (!lastUser) return "medium";

	const text = extractText(lastUser.content);
	if (!text) return "medium";

	// Short-circuit trivial prompts without a model call.
	const trimmed = text.trim();
	if (trimmed.length < 15 && !trimmed.includes("?")) return "minimal";

	const classifyContext: Context = {
		systemPrompt: CLASSIFY_PROMPT,
		messages: [{ role: "user", content: redactString(trimmed.slice(0, 2000)), timestamp: Date.now() }],
	};

	try {
		const stream = await streamFn(model, classifyContext, { maxTokens: 10, signal });
		const result = await stream.result();
		const reply = extractText(result.content)?.trim().toLowerCase() ?? "";
		const match = CLASSIFY_LEVELS.find((l) => reply.includes(l));
		return match ?? "medium";
	} catch {
		return "medium";
	}
}

function extractText(content: unknown): string | undefined {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.filter((c): c is TextContent => c?.type === "text")
			.map((c) => c.text)
			.join(" ");
	}
	return undefined;
}
