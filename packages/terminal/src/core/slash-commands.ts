import { APP_NAME } from "../config.ts";
import type { SourceInfo } from "./source-info.ts";

export type SlashCommandSource = "extension" | "prompt" | "skill";

export interface SlashCommandInfo {
	name: string;
	description?: string;
	source: SlashCommandSource;
	sourceInfo: SourceInfo;
}

export interface BuiltinSlashCommand {
	name: string;
	description: string;
}

export const BUILTIN_SLASH_COMMANDS: ReadonlyArray<BuiltinSlashCommand> = [
	{ name: "settings", description: "Open settings menu" },
	{ name: "model", description: "Select model (opens selector UI)" },
	{ name: "thinking", description: "Select reasoning level for the current model" },
	{ name: "skills", description: "Browse and run available skills" },
	{ name: "export", description: "Export session (HTML default, or specify path: .html/.jsonl)" },
	{ name: "import", description: "Import and resume a session from a JSONL file" },
	{ name: "copy", description: "Copy last agent message to clipboard" },
	{ name: "name", description: "Set session display name" },
	{ name: "session", description: "Show session info and stats" },
	{ name: "stats", description: "Show per-run telemetry with cache-aware token accounting" },
	{ name: "cache", description: "Show cache hit rate, savings, and prefix hash" },
	{ name: "hotkeys", description: "Show all keyboard shortcuts" },
	{ name: "fork", description: "Create a new fork from a previous user message" },
	{ name: "clone", description: "Duplicate the current session at the current position" },
	{ name: "tree", description: "Navigate session tree (switch branches)" },
	{ name: "login", description: "Configure provider authentication" },
	{ name: "logout", description: "Remove provider authentication" },
	{ name: "new", description: "Start a new session" },
	{ name: "compact", description: "Manually compact the session context" },
	{ name: "goal", description: "Enter autonomous goal mode: agent loops until goal is achieved (Esc to stop)" },
	{ name: "reality-check", description: "Spawn a devil's advocate subagent to challenge the last response for honesty and accuracy" },
	{ name: "resume", description: "Resume a different session" },
	{ name: "reload", description: "Reload keybindings, extensions, skills, prompts, and themes" },
	{ name: "read", description: "Read a file instantly and display its contents in chat" },
	{ name: "grep", description: "Search file contents instantly and display matches in chat" },
	{ name: "edit", description: "Apply a simple edit to a file instantly" },
	{ name: "todo", description: "Show or add to the local task list" },
	{ name: "quit", description: `Quit ${APP_NAME}` },
];
