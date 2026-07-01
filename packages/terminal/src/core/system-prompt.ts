/**
 * System prompt construction and project context loading.
 *
 * The prompt is built from discrete blocks. Each block is content-addressed
 * with a SHA-256 hash so cache invalidation can be attributed to the exact
 * block that changed. See docs/cache-aware-design.md for the layer model.
 */

import { createHash } from "node:crypto";
import type { LoadedMemory } from "./memory.ts";
import { MISUL_CONSTITUTION } from "./misul-system-prompt.ts";

import { formatSkillsForPrompt, type Skill } from "./skills.ts";

export interface BuildSystemPromptOptions {
	/** Custom system prompt (replaces default). */
	customPrompt?: string;
	/** Tools to include in prompt. Default: [read, bash, edit, write] */
	selectedTools?: string[];
	/** Optional one-line tool snippets keyed by tool name. */
	toolSnippets?: Record<string, string>;
	/** Additional guideline bullets appended to the default system prompt guidelines. */
	promptGuidelines?: string[];
	/** Text to append to system prompt. */
	appendSystemPrompt?: string;
	/** Working directory. */
	cwd: string;
	/** Pre-loaded context files. */
	contextFiles?: Array<{ path: string; content: string }>;
	/** Pre-loaded skills. */
	skills?: Skill[];
	/** Persistent agent memory, injected at session start (see core/memory.ts). */
	memory?: LoadedMemory;
}

/** A single content-addressed block of the system prompt. */
export interface PromptBlock {
	/** Stable block identifier (e.g. "constitution", "tools", "memory"). */
	id: string;
	/** Block text as it appears in the final prompt. */
	text: string;
	/** SHA-256 hash of the block text. */
	hash: string;
}

/** Result of building a system prompt: the full text plus block hashes. */
export interface BuiltSystemPrompt {
	prompt: string;
	blocks: PromptBlock[];
	/** SHA-256 hash of all block hashes concatenated, in order. */
	prefixHash: string;
}

function sha256(text: string): string {
	return createHash("sha256").update(text, "utf8").digest("hex");
}

function makeBlock(id: string, text: string): PromptBlock {
	return { id, text, hash: sha256(text) };
}

/**
 * Normalize a context file path to a stable, machine-independent form.
 * Absolute paths under cwd are converted to relative paths. Paths outside
 * cwd are kept as-is (they may be global config files like ~/.misul/agent/MISUL.md).
 * Backslashes are normalized to forward slashes for cross-platform stability.
 */
function normalizeContextPath(filePath: string, cwd: string): string {
	const normalized = filePath.replace(/\\/g, "/");
	const normalizedCwd = cwd.replace(/\\/g, "/");
	const cwdPrefix = normalizedCwd.endsWith("/") ? normalizedCwd : `${normalizedCwd}/`;
	if (normalized.startsWith(cwdPrefix)) {
		return normalized.slice(cwdPrefix.length);
	}
	if (normalized === normalizedCwd) {
		return ".";
	}
	return normalized;
}

/** Build the system prompt with tools, guidelines, and context. */
export function buildSystemPrompt(options: BuildSystemPromptOptions): string {
	return buildSystemPromptWithBlocks(options).prompt;
}

/** Build the system prompt and return block hashes for cache diagnostics. */
export function buildSystemPromptWithBlocks(options: BuildSystemPromptOptions): BuiltSystemPrompt {
	const {
		customPrompt,
		selectedTools,
		toolSnippets,
		promptGuidelines,
		appendSystemPrompt,
		cwd,
		contextFiles: providedContextFiles,
		skills: providedSkills,
	} = options;
	const resolvedCwd = cwd;
	const promptCwd = resolvedCwd.replace(/\\/g, "/");

	const contextFiles = providedContextFiles ?? [];
	const skills = providedSkills ?? [];

	if (customPrompt) {
		const blocks: PromptBlock[] = [];
		blocks.push(makeBlock("custom_prompt", customPrompt));

		if (appendSystemPrompt) {
			blocks.push(makeBlock("append", `\n\n${appendSystemPrompt}`));
		}
		if (options.memory) {
			blocks.push(makeBlock("memory", `\n\n<memory path="${options.memory.path}">\nPersistent memory from earlier sessions. Apply it silently — do not announce that you are using memory — and keep it accurate by editing this file when durable facts change.\n\n${options.memory.content}\n</memory>\n`));
		}
		if (contextFiles.length > 0) {
			const sorted = [...contextFiles].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
			let text = "\n\n<project_context>\n\nProject-specific instructions and guidelines:\n\n";
			for (const { path: filePath, content } of sorted) {
				const stablePath = normalizeContextPath(filePath, resolvedCwd);
				text += `<project_instructions path="${stablePath}">\n${content}\n</project_instructions>\n\n`;
			}
			text += "</project_context>\n";
			blocks.push(makeBlock("project_context", text));
		}
		const customPromptHasRead = !selectedTools || selectedTools.includes("read");
		if (customPromptHasRead && skills.length > 0) {
			blocks.push(makeBlock("skills", formatSkillsForPrompt(skills)));
		}
		blocks.push(makeBlock("env", `\nCurrent working directory: ${promptCwd}\nMisul Terminal documentation: docs/ (read .md files there when modifying Misul Terminal itself; use find to locate the docs directory in the installation)`));

		const prompt = blocks.map((b) => b.text).join("");
		const prefixHash = sha256(blocks.map((b) => b.hash).join(""));
		return { prompt, blocks, prefixHash };
	}

	// Build tools list based on selected tools.
	const tools = selectedTools || ["read", "bash", "edit", "write"];
	const visibleTools = tools.filter((name) => !!toolSnippets?.[name]);
	const toolsList =
		visibleTools.length > 0 ? visibleTools.map((name) => `- ${name}: ${toolSnippets![name]}`).join("\n") : "(none)";

	// Build guidelines based on which tools are actually available
	const guidelinesList: string[] = [];
	const guidelinesSet = new Set<string>();
	const addGuideline = (guideline: string): void => {
		if (guidelinesSet.has(guideline)) return;
		guidelinesSet.add(guideline);
		guidelinesList.push(guideline);
	};

	const hasBash = tools.includes("bash");
	const hasGrep = tools.includes("grep");
	const hasFind = tools.includes("find");
	const hasLs = tools.includes("ls");
	const hasRead = tools.includes("read");

	if (hasBash && !hasGrep && !hasFind && !hasLs) {
		addGuideline("Use bash for file operations like ls, rg, find");
	}
	for (const guideline of promptGuidelines ?? []) {
		const normalized = guideline.trim();
		if (normalized.length > 0) addGuideline(normalized);
	}
	addGuideline("Be concise in your responses");
	addGuideline("Show file paths clearly when working with files");

	const guidelines = guidelinesList.map((g) => `- ${g}`).join("\n");

	const blocks: PromptBlock[] = [];

	// Block 1: Constitution (agent identity)
	blocks.push(makeBlock("constitution", MISUL_CONSTITUTION));

	// Block 2: Tools list
	blocks.push(makeBlock("tools", `\n\nAvailable tools:\n${toolsList}\n\nIn addition to the tools above, you may have access to other custom tools depending on the project.`));

	// Block 3: Guidelines
	blocks.push(makeBlock("guidelines", `\n\nGuidelines:\n${guidelines}`));

	// Block 4: Append (user-supplied extra prompt)
	if (appendSystemPrompt) {
		blocks.push(makeBlock("append", `\n\n${appendSystemPrompt}`));
	}

	// Block 5: Memory (persistent, durable)
	if (options.memory) {
		blocks.push(makeBlock("memory", `\n\n<memory path="${options.memory.path}">\nPersistent memory from earlier sessions. Apply it silently — do not announce that you are using memory — and keep it accurate by editing this file when durable facts change.\n\n${options.memory.content}\n</memory>\n`));
	}

	// Block 6: Project context (MISUL.md global, AGENTS.md per-project, etc.)
	// Sort by path for deterministic serialization regardless of traversal order.
	// Normalize absolute paths to relative for cache stability across machines.
	if (contextFiles.length > 0) {
		const sorted = [...contextFiles].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
		let text = "\n\n<project_context>\n\nProject-specific instructions and guidelines:\n\n";
		for (const { path: filePath, content } of sorted) {
			const stablePath = normalizeContextPath(filePath, resolvedCwd);
			text += `<project_instructions path="${stablePath}">\n${content}\n</project_instructions>\n\n`;
		}
		text += "</project_context>\n";
		blocks.push(makeBlock("project_context", text));
	}

	// Block 7: Skills
	if (hasRead && skills.length > 0) {
		blocks.push(makeBlock("skills", formatSkillsForPrompt(skills)));
	}

	// Block 8: Environment (cwd, docs path)
	blocks.push(makeBlock("env", `\nCurrent working directory: ${promptCwd}\nMisul Terminal documentation: docs/ (read .md files there when modifying Misul Terminal itself; use find to locate the docs directory in the installation)`));

	const prompt = blocks.map((b) => b.text).join("");
	const prefixHash = sha256(blocks.map((b) => b.hash).join(""));
	return { prompt, blocks, prefixHash };
}
