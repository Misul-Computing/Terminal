/**
 * Automode permission gate.
 *
 * Classifies tool calls by risk level using rules first (zero tokens),
 * then a lightweight model call for ambiguous cases. When a tool call
 * needs user confirmation, the agent asks in natural language in the
 * chat. The user's reply is interpreted by a lightweight model call.
 */

import type { Model } from "@misul/ai";
import { completeSimple, type Context, type SimpleStreamOptions } from "@misul/ai";

/** Risk level for a tool call. */
export type RiskLevel = "safe" | "moderate" | "dangerous";

/** Result of risk assessment. */
export interface RiskAssessment {
	level: RiskLevel;
	/** Human-readable summary of what the tool call does, for the model prompt. */
	summary: string;
	/** Why this risk level was chosen. */
	reason: string;
}

/** Result of interpreting a user's natural language response. */
export interface PermissionResponse {
	decision: "approve" | "deny" | "modify";
	/** When decision is "modify", the modified instruction or clarification. */
	modifiedInstruction?: string;
}

/** Configuration for the permission gate. */
export interface PermissionGateConfig {
	/** Whether automode is enabled. When false, all tool calls are allowed. */
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
}

/**
 * Assess the risk of a tool call using rules.
 *
 * Rules (zero tokens):
 * - read, ls, cat, grep, glob, find, search -> safe
 * - edit, write, notebook_edit -> moderate
 * - bash with safe commands (ls, cat, echo, git status, npm test) -> safe
 * - bash with mutations (rm, git push, npm install, sudo, chmod) -> dangerous
 * - bash with other commands -> moderate
 * - mcp_* tools -> moderate (unknown external tools)
 */
export function assessRisk(
	toolName: string,
	args: Record<string, unknown>,
): RiskAssessment {
	// Read-only tools are always safe
	const safeTools = new Set([
		"read", "ls", "cat", "grep", "glob", "find", "search",
		"read_file", "read_subagent", "web_search", "webfetch",
		"notebook_read", "mcp_list_servers", "mcp_list_tools", "mcp_read_resource",
		"todo_write", "ask_user_question", "skill",
	]);
	if (safeTools.has(toolName)) {
		return {
			level: "safe",
			summary: `${toolName}`,
			reason: "Read-only tool",
		};
	}

	// Edit/write tools are moderate
	const editTools = new Set(["edit", "write", "notebook_edit", "edit_file"]);
	if (editTools.has(toolName)) {
		const path = String(args.file_path ?? args.path ?? args.notebook_path ?? "<unknown>");
		return {
			level: "moderate",
			summary: `${toolName} ${path}`,
			reason: "File modification",
		};
	}

	// Bash: classify by command content
	if (toolName === "bash" || toolName === "exec" || toolName === "execute_command") {
		const command = String(args.command ?? "");
		return assessBashRisk(command);
	}

	// MCP tools are moderate (unknown external effects)
	if (toolName.startsWith("mcp_") || toolName.startsWith("mcpCallTool")) {
		return {
			level: "moderate",
			summary: `${toolName} ${JSON.stringify(args).slice(0, 100)}`,
			reason: "External MCP tool with unknown effects",
		};
	}

	// Unknown tools default to moderate
	return {
		level: "moderate",
		summary: `${toolName} ${JSON.stringify(args).slice(0, 100)}`,
		reason: "Unknown tool, defaulting to moderate",
	};
}

/** Dangerous bash command patterns. */
const DANGEROUS_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
	{ pattern: /\brm\s+-rf?\b/i, reason: "Recursive delete" },
	{ pattern: /\brm\b/i, reason: "File deletion" },
	{ pattern: /\bgit\s+push\b/i, reason: "Git push to remote" },
	{ pattern: /\bgit\s+reset\s+--hard\b/i, reason: "Hard git reset" },
	{ pattern: /\bgit\s+clean\s+-[a-z]*f/i, reason: "Git clean force" },
	{ pattern: /\bsudo\b/i, reason: "Sudo command" },
	{ pattern: /\bchmod\b/i, reason: "Permission change" },
	{ pattern: /\bchown\b/i, reason: "Ownership change" },
	{ pattern: /\bkill\b/i, reason: "Process kill" },
	{ pattern: /\bpkill\b/i, reason: "Process kill" },
	{ pattern: /\bshutdown\b/i, reason: "System shutdown" },
	{ pattern: /\breboot\b/i, reason: "System reboot" },
	{ pattern: /\bdd\b/i, reason: "Disk operations" },
	{ pattern: /\bmkfs\b/i, reason: "Filesystem format" },
	{ pattern: /\b>\s*\/dev\//i, reason: "Write to device" },
	{ pattern: /\bcurl\b.*\|\s*(sh|bash|zsh)\b/i, reason: "Pipe to shell" },
	{ pattern: /\bwget\b.*\|\s*(sh|bash|zsh)\b/i, reason: "Pipe to shell" },
	{ pattern: /\bnpm\s+publish\b/i, reason: "Npm publish" },
	{ pattern: /\bdocker\s+(rm|rmi|prune)\b/i, reason: "Docker removal" },
	{ pattern: /\bdrop\s+(table|database|schema)\b/i, reason: "Database drop" },
	{ pattern: /\btruncate\b/i, reason: "Table truncate" },
	{ pattern: /\bDROP\s+/i, reason: "SQL DROP" },
	{ pattern: /\bforce\s+push\b/i, reason: "Force push" },
];

/** Safe bash command patterns (checked first). */
const SAFE_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
	{ pattern: /^ls\b/i, reason: "List files" },
	{ pattern: /^cat\b/i, reason: "Read file" },
	{ pattern: /^echo\b/i, reason: "Echo" },
	{ pattern: /^pwd\b/i, reason: "Print directory" },
	{ pattern: /^whoami\b/i, reason: "User info" },
	{ pattern: /^date\b/i, reason: "Date" },
	{ pattern: /^git\s+status\b/i, reason: "Git status" },
	{ pattern: /^git\s+diff\b/i, reason: "Git diff" },
	{ pattern: /^git\s+log\b/i, reason: "Git log" },
	{ pattern: /^git\s+branch\b/i, reason: "Git branch" },
	{ pattern: /^npm\s+test\b/i, reason: "Run tests" },
	{ pattern: /^npm\s+run\b/i, reason: "Run npm script" },
	{ pattern: /^npx\s+tsc\b/i, reason: "Type check" },
	{ pattern: /^npx\s+tsgo\b/i, reason: "Type check" },
	{ pattern: /^node\s+--version\b/i, reason: "Check version" },
	{ pattern: /^npm\s+--version\b/i, reason: "Check version" },
	{ pattern: /^head\b/i, reason: "Read file head" },
	{ pattern: /^tail\b/i, reason: "Read file tail" },
	{ pattern: /^wc\b/i, reason: "Word count" },
	{ pattern: /^which\b/i, reason: "Find command" },
	{ pattern: /^env\b/i, reason: "Environment" },
	{ pattern: /^printenv\b/i, reason: "Print env" },
	{ pattern: /^true\b/i, reason: "No-op" },
	{ pattern: /^false\b/i, reason: "No-op" },
	{ pattern: /^test\b/i, reason: "Test condition" },
	{ pattern: /^\[\b/, reason: "Test condition" },
];

function assessBashRisk(command: string): RiskAssessment {
	const trimmed = command.trim();

	// Check safe patterns first
	for (const { pattern, reason } of SAFE_PATTERNS) {
		if (pattern.test(trimmed)) {
			return {
				level: "safe",
				summary: `$ ${trimmed.slice(0, 120)}`,
				reason,
			};
		}
	}

	// Check dangerous patterns
	for (const { pattern, reason } of DANGEROUS_PATTERNS) {
		if (pattern.test(trimmed)) {
			return {
				level: "dangerous",
				summary: `$ ${trimmed.slice(0, 120)}`,
				reason,
			};
		}
	}

	// Default: moderate
	return {
		level: "moderate",
		summary: `$ ${trimmed.slice(0, 120)}`,
		reason: "Unknown bash command",
	};
}

/**
 * Use a lightweight model call to assess ambiguous risk.
 * Called only for "moderate" risk tool calls where rules are uncertain.
 *
 * Returns true if the model says the call is safe to auto-approve,
 * false if it needs user confirmation.
 */
export async function modelAssessSafety(
	toolName: string,
	summary: string,
	reason: string,
	config: PermissionGateConfig,
): Promise<boolean> {
	if (!config.model) return false;

	const prompt = `Is this tool call safe to run automatically without asking the user?

Tool: ${toolName}
Action: ${summary}
Reason for uncertainty: ${reason}

Reply with only "safe" or "ask".`;

	try {
		const result = await callModel(prompt, config);
		const text = result.trim().toLowerCase();
		return text.startsWith("safe");
	} catch {
		// On any error, default to asking
		return false;
	}
}

/**
 * Interpret a user's natural language response to a permission request.
 * Uses a lightweight model call.
 *
 * Examples:
 *   "yeah go ahead" -> approve
 *   "no, just delete the .o files" -> modify
 *   "nope" -> deny
 *   "sure" -> approve
 *   "use a different path" -> modify
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
		if (lower === w || lower.startsWith(w + " ") || lower.startsWith(w + ".")) {
			// Check if there's a modification suggestion after the denial
			break;
		}
	}

	// Check for pure deny
	for (const w of denyWords) {
		if (lower === w) {
			return { decision: "deny" };
		}
	}

	// Model call for ambiguous responses
	if (!config.model) {
		// No model: default to approve if it looks positive, deny otherwise
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
		// Try to parse JSON
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
		// Fallback: check for keywords
		if (/approve|yes|sure|go|proceed/i.test(text)) return { decision: "approve" };
		if (/deny|no|stop|cancel/i.test(text)) return { decision: "deny" };
		return { decision: "modify", modifiedInstruction: userReply };
	} catch {
		// On error, treat as modify with the raw reply
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

	// Add timeout via AbortController
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), config.timeoutMs ?? 10000);
	options.signal = controller.signal;

	try {
		const result = await completeSimple(config.model, context, options);
		// Extract text from the response
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

/**
 * Check if a tool call needs user permission.
 *
 * Returns true if the call should be blocked and the user should be asked.
 * Returns false if the call is safe to auto-approve.
 *
 * Flow:
 * 1. If automode is disabled, return false (everything allowed)
 * 2. Assess risk using rules (zero tokens)
 * 3. If safe, return false
 * 4. If dangerous, return true (always ask)
 * 5. If moderate, use model to assess (lightweight call)
 * 6. If model says safe, return false
 * 7. Otherwise, return true (ask user)
 */
export async function needsPermission(
	toolName: string,
	args: Record<string, unknown>,
	config: PermissionGateConfig,
): Promise<{ ask: boolean; assessment: RiskAssessment }> {
	if (!config.enabled) {
		return { ask: false, assessment: { level: "safe", summary: "", reason: "Automode disabled" } };
	}

	const assessment = assessRisk(toolName, args);

	if (assessment.level === "safe") {
		return { ask: false, assessment };
	}

	if (assessment.level === "dangerous") {
		return { ask: true, assessment };
	}

	// Moderate: use model to decide
	const modelSaysSafe = await modelAssessSafety(toolName, assessment.summary, assessment.reason, config);
	return { ask: !modelSaysSafe, assessment };
}
