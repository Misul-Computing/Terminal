// Capability system: the internal spine for what the agent can do.
// Unifies tool availability, permission decisions, and subagent
// constraints into a single capability registry.
//
// No user-facing UI. The agent queries capabilities internally to decide
// what tools are available, what needs confirmation, what subagents can
// do, and what goal mode may touch. Everything is derived from settings,
// trust state, and the active tool set.

import type { SettingsManager } from "./settings-manager.ts";

export type Capability =
	| "read"
	| "edit"
	| "write"
	| "bash"
	| "grep"
	| "find"
	| "ls"
	| "spawn_agent"
	| "web_search"
	| "mcp"
	| "debug"
	| "goal_mode"
	| "network"
	| "write_outside_repo"
	| "modify_settings"
	| "destructive_git";

export interface CapabilityContext {
	cwd: string;
	projectTrusted: boolean;
	activeTools: string[];
	enableSubagents: boolean;
	goalMode: boolean;
}

export interface CapabilityDecision {
	/** The capability is available at all. */
	available: boolean;
	/** Using this capability requires user confirmation. */
	needsConfirmation: boolean;
	/** Reason for the decision, for logging/debugging. */
	reason: string;
}

/** Read-only tools that never need confirmation. */
const SAFE_CAPABILITIES: ReadonlySet<Capability> = new Set([
	"read",
	"grep",
	"find",
	"ls",
]);

/** Capabilities that always need confirmation, even in trusted projects. */
const ALWAYS_CONFIRM: ReadonlySet<Capability> = new Set([
	"destructive_git",
	"write_outside_repo",
]);

/** Capabilities that subagents cannot use, regardless of config. */
const SUBAGENT_BLOCKED: ReadonlySet<Capability> = new Set([
	"spawn_agent",
	"modify_settings",
	"goal_mode",
]);

export class CapabilityRegistry {
	private _settings: SettingsManager;

	constructor(settings: SettingsManager) {
		this._settings = settings;
	}

	/** Check a capability for the current context. */
	check(cap: Capability, ctx: CapabilityContext): CapabilityDecision {
		// Subagents are restricted.
		if (!ctx.enableSubagents && SUBAGENT_BLOCKED.has(cap)) {
			return { available: false, needsConfirmation: false, reason: "blocked for subagents" };
		}

		// Goal mode has expanded permissions for non-destructive capabilities.
		if (ctx.goalMode && !ALWAYS_CONFIRM.has(cap) && cap !== "spawn_agent") {
			return { available: true, needsConfirmation: false, reason: "goal mode" };
		}

		// Read-only tools are always available.
		if (SAFE_CAPABILITIES.has(cap)) {
			return { available: true, needsConfirmation: false, reason: "safe" };
		}

		// Check if the tool is in the active tool set.
		if (!this._isToolActive(cap, ctx)) {
			return { available: false, needsConfirmation: false, reason: "tool not active" };
		}

		// Untrusted project: block write capabilities.
		if (!ctx.projectTrusted && this._isWriteCapability(cap)) {
			return { available: false, needsConfirmation: false, reason: "project not trusted" };
		}

		// Always-confirm capabilities.
		if (ALWAYS_CONFIRM.has(cap)) {
			return { available: true, needsConfirmation: true, reason: "always confirm" };
		}

		// Write capabilities in trusted projects: available but may need confirmation.
		// The permission gate handles the actual risk assessment.
		if (this._isWriteCapability(cap)) {
			return { available: true, needsConfirmation: true, reason: "write capability" };
		}

		return { available: true, needsConfirmation: false, reason: "default" };
	}

	/** Get all available capabilities for a context. */
	available(ctx: CapabilityContext): Capability[] {
		const all: Capability[] = [
			"read", "edit", "write", "bash", "grep", "find", "ls",
			"spawn_agent", "web_search", "mcp", "debug", "goal_mode",
			"network", "write_outside_repo",
			"modify_settings", "destructive_git",
		];
		return all.filter((cap) => this.check(cap, ctx).available);
	}

	/** Map a tool name to a capability. */
	static toolToCapability(toolName: string): Capability | undefined {
		const map: Record<string, Capability> = {
			read: "read",
			bash: "bash",
			edit: "edit",
			write: "write",
			grep: "grep",
			find: "find",
			ls: "ls",
			spawn_agent: "spawn_agent",
			web_search: "web_search",
			debug_launch: "debug",
			debug_breakpoint: "debug",
			debug_stack: "debug",
			debug_variables: "debug",
			debug_continue: "debug",
			debug_step: "debug",
			debug_evaluate: "debug",
			debug_disconnect: "debug",
		};
		// MCP tools map to the mcp capability.
		if (toolName.startsWith("mcp__")) return "mcp";
		return map[toolName];
	}

	private _isToolActive(cap: Capability, ctx: CapabilityContext): boolean {
		if (SAFE_CAPABILITIES.has(cap)) return true;
		const toolName = this._capabilityToTool(cap);
		if (!toolName) return true;
		return ctx.activeTools.includes(toolName);
	}

	private _isWriteCapability(cap: Capability): boolean {
		return cap === "edit" || cap === "write" || cap === "bash" ||
			cap === "write_outside_repo" || cap === "destructive_git" ||
			cap === "modify_settings";
	}

	private _capabilityToTool(cap: Capability): string | undefined {
		const map: Record<Capability, string | undefined> = {
			read: "read",
			edit: "edit",
			write: "write",
			bash: "bash",
			grep: "grep",
			find: "find",
			ls: "ls",
			spawn_agent: "spawn_agent",
			web_search: "web_search",
			mcp: undefined,
			debug: "debug_launch",
			goal_mode: undefined,
			network: undefined,
			write_outside_repo: undefined,
			modify_settings: undefined,
			destructive_git: undefined,
		};
		return map[cap];
	}
}
