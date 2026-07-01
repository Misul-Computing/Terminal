/**
 * Permission gate.
 *
 * Read-only tools run automatically. Everything else: one lightweight
 * model call with conversation context decides whether to ask or just
 * run it. No hardcoded dangerous patterns. The model sees what the user
 * asked for and what the agent is about to do, then decides.
 */

import type { Model } from "@misul/ai";
import { completeSimple, type Context, type SimpleStreamOptions } from "@misul/ai";

/** Result of risk assessment. */
export interface RiskAssessment {
	/** Whether to ask the user before running. */
	ask: boolean;
	/** Human-readable summary of what the tool call does. */
	summary: string;
}

/** Result of interpreting a user's natural language response. */
export interface PermissionResponse {
	decision: "approve" | "deny" | "modify";
	/** When decision is "modify", the modified instruction or clarification. */
	modifiedInstruction?: string;
}

/** Configuration for the permission gate. */
export interface PermissionGateConfig {
	/** Whether the gate is enabled. When false, all tool calls are allowed. */
	enabled: boolean;
	/** Model to use for risk assessment and response interpretation. */
	model?: Model<any>;
	/** API key and headers for model calls. */
	apiKey?: string;
	headers?: Record<string, string>;
	/** Max tokens for lightweight model calls. Default: 256. */
	maxTokens?: number;
	/** Timeout for model calls in ms. Default: 10000. */
	timeoutMs?: number;
	/** Recent conversation context for context-aware risk assessment. */
	context?: string;
}

/**
 * Read-only tools that never need permission. This is an optimization,
 * not a safety gate. No point calling the model to ask "should I read
 * a file?"
 */
const SAFE_TOOLS = new Set([
	"read", "ls", "cat", "grep", "glob", "find", "search",
	"read_file", "read_subagent", "web_search", "webfetch",
	"notebook_read", "mcp_list_servers", "mcp_list_tools", "mcp_read_resource",
	"todo_write", "ask_user_question", "skill",
]);

/**
 * Check if a tool call needs user permission.
 *
 * Read-only tools: no, always auto-run.
 * Everything else: ask the model with conversation context.
 */
export async function needsPermission(
	toolName: string,
	args: Record<string, unknown>,
	config: PermissionGateConfig,
): Promise<{ ask: boolean; assessment: RiskAssessment }> {
	if (!config.enabled) {
		return { ask: false, assessment: { ask: false, summary: "" } };
	}

	if (SAFE_TOOLS.has(toolName)) {
		return { ask: false, assessment: { ask: false, summary: toolName } };
	}

	const summary = buildSummary(toolName, args);

	// No model configured: default to asking for anything non-safe.
	// This is the conservative fallback.
	if (!config.model) {
		return { ask: true, assessment: { ask: true, summary } };
	}

	const ask = await modelDecide(toolName, summary, config);
	return { ask, assessment: { ask, summary } };
}

function buildSummary(toolName: string, args: Record<string, unknown>): string {
	if (toolName === "bash" || toolName === "exec" || toolName === "execute_command") {
		return `$ ${String(args.command ?? "").slice(0, 200)}`;
	}
	const path = args.file_path ?? args.path ?? args.notebook_path;
	if (path) {
		return `${toolName} ${String(path)}`;
	}
	return `${toolName} ${JSON.stringify(args).slice(0, 150)}`;
}

/**
 * Ask the model whether to run the tool call automatically or ask the user.
 * The model sees the conversation context, so "git push" after the user
 * said "fix and push" will auto-run, while "git push" out of nowhere will
 * ask.
 */
async function modelDecide(
	toolName: string,
	summary: string,
	config: PermissionGateConfig,
): Promise<boolean> {
	const context = config.context?.slice(-2000) ?? "";

	const prompt = `You are deciding whether an AI coding agent should run a tool call automatically or ask the user first.

Recent conversation:
${context}

The agent is about to run:
${summary}

Should the agent just run this, or ask the user first?

Run it automatically when:
- The user clearly asked for this action or something that requires it
- It's a normal part of the task the user described
- It's reversible or low-impact (editing a file the user asked you to edit, running a build, running tests)

Ask the user first when:
- The action is destructive and wasn't clearly requested (deleting files, force pushing, dropping tables)
- It has side effects outside the repo (publishing, deploying, sending emails, payments)
- You're not sure what the user wants

Reply with only "run" or "ask".`;

	try {
		const result = await callModel(prompt, config);
		const text = result.trim().toLowerCase();
		return text.startsWith("ask");
	} catch {
		// On any error, ask. Don't auto-run when uncertain.
		return true;
	}
}

/**
 * Interpret a user's natural language response to a permission request.
 */
export async function interpretPermissionResponse(
	userReply: string,
	originalAction: string,
	config: PermissionGateConfig,
): Promise<PermissionResponse> {
	// Fast path: obvious approve/deny without model
	const lower = userReply.trim().toLowerCase();
	const approveWords = ["yes", "yeah", "yep", "sure", "go", "go ahead", "ok", "okay", "do it", "proceed", "continue", "y", "fine", "sounds good", "that works"];
	const denyWords = ["no", "nope", "stop", "don't", "dont", "n", "cancel", "never", "wait", "hold on"];

	for (const w of approveWords) {
		if (lower === w || lower.startsWith(w + " ") || lower.startsWith(w + ".")) {
			return { decision: "approve" };
		}
	}
	for (const w of denyWords) {
		if (lower === w) {
			return { decision: "deny" };
		}
	}

	// Model call for ambiguous responses
	if (!config.model) {
		for (const w of approveWords) {
			if (lower.includes(w)) return { decision: "approve" };
		}
		return { decision: "deny" };
	}

	const prompt = `The user was asked for permission to: ${originalAction}

The user replied: "${userReply}"

Classify the reply as one of:
- approve: user agrees to proceed as proposed
- deny: user refuses and wants to stop
- modify: user wants to proceed but with changes (include the modified instruction)

Reply in JSON: {"decision":"approve"} or {"decision":"deny"} or {"decision":"modify","modifiedInstruction":"..."}`;

	try {
		const result = await callModel(prompt, config);
		const text = result.trim();
		const jsonMatch = text.match(/\{[^}]+\}/);
		if (jsonMatch) {
			const parsed = JSON.parse(jsonMatch[0]);
			if (parsed.decision === "approve") return { decision: "approve" };
			if (parsed.decision === "deny") return { decision: "deny" };
			if (parsed.decision === "modify") {
				return {
					decision: "modify",
					modifiedInstruction: parsed.modifiedInstruction ?? String(parsed.modification ?? ""),
				};
			}
		}
		if (/approve|yes|sure|go|proceed/i.test(text)) return { decision: "approve" };
		if (/deny|no|stop|cancel/i.test(text)) return { decision: "deny" };
		return { decision: "modify", modifiedInstruction: userReply };
	} catch {
		return { decision: "modify", modifiedInstruction: userReply };
	}
}

/**
 * Make a lightweight model call and return the text response.
 */
async function callModel(prompt: string, config: PermissionGateConfig): Promise<string> {
	if (!config.model) throw new Error("No model configured");

	const context: Context = {
		systemPrompt: "You are a permission assistant. Be extremely concise.",
		messages: [
			{
				role: "user",
				content: [{ type: "text", text: prompt }],
				timestamp: Date.now(),
			},
		],
	};

	const options: SimpleStreamOptions = {
		apiKey: config.apiKey,
		headers: config.headers,
		maxTokens: config.maxTokens ?? 256,
	};

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), config.timeoutMs ?? 10000);
	options.signal = controller.signal;

	try {
		const result = await completeSimple(config.model, context, options);
		const textParts: string[] = [];
		for (const block of result.content) {
			if (block.type === "text") {
				textParts.push(block.text);
			}
		}
		return textParts.join("");
	} finally {
		clearTimeout(timeout);
	}
}
