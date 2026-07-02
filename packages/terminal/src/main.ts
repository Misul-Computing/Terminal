/**
 * Main entry point for the coding agent CLI.
 *
 * This file handles CLI argument parsing and translates them into
 * createAgentSession() options. The SDK does the heavy lifting.
 */

import chalk from "chalk";
import { type Args, type Mode, parseArgs, printHelp } from "./cli/args.ts";
import { ENV_SESSION_DIR, expandTildePath, getAgentDir, getEnvFlag, getPackageDir, VERSION } from "./config.ts";
import {
	applyHttpProxySettings,
	configureHttpDispatcher,
	DEFAULT_HTTP_IDLE_TIMEOUT_MS,
	OFFLINE_CONNECT_TIMEOUT_MS,
} from "./core/http-dispatcher.ts";
import { SettingsManager } from "./core/settings-manager.ts";
import { printTimings, resetTimings, time } from "./core/timings.ts";

import type { ImageContent } from "@misul/ai";
import type { ExtensionFactory } from "./core/extensions/types.ts";
import type { ModelRegistry } from "./core/model-registry.ts";
import type { CreateAgentSessionOptions } from "./core/sdk.ts";
import type { AgentSessionRuntimeDiagnostic } from "./core/agent-session-services.ts";
import type { ScopedModel } from "./core/model-resolver.ts";
import type { SessionCwdIssue } from "./core/session-cwd.ts";
import type { AppMode } from "./core/project-trust.ts";
import type { CreateAgentSessionRuntimeFactory } from "./core/agent-session-runtime.ts";

/**
 * Read all content from piped stdin.
 * Returns undefined if stdin is a TTY (interactive terminal).
 */
async function readPipedStdin(): Promise<string | undefined> {
	// If stdin is a TTY, we're running interactively - don't read stdin
	if (process.stdin.isTTY) {
		return undefined;
	}

	return new Promise((resolve) => {
		let data = "";
		process.stdin.setEncoding("utf8");
		process.stdin.on("data", (chunk) => {
			data += chunk;
		});
		process.stdin.on("end", () => {
			resolve(data.trim() || undefined);
		});
		process.stdin.resume();
	});
}

function collectSettingsDiagnostics(
	settingsManager: SettingsManager,
	context: string,
): AgentSessionRuntimeDiagnostic[] {
	return settingsManager.drainErrors().map(({ scope, error }) => ({
		type: "warning",
		message: `(${context}, ${scope} settings) ${error.message}`,
	}));
}

function reportDiagnostics(diagnostics: readonly AgentSessionRuntimeDiagnostic[]): void {
	for (const diagnostic of diagnostics) {
		const color = diagnostic.type === "error" ? chalk.red : diagnostic.type === "warning" ? chalk.yellow : chalk.dim;
		const prefix = diagnostic.type === "error" ? "Error: " : diagnostic.type === "warning" ? "Warning: " : "";
		console.error(color(`${prefix}${diagnostic.message}`));
	}
}

function isTruthyEnvFlag(value: string | undefined): boolean {
	if (!value) return false;
	return value === "1" || value.toLowerCase() === "true" || value.toLowerCase() === "yes";
}

function resolveAppMode(parsed: Args, stdinIsTTY: boolean, stdoutIsTTY: boolean): AppMode {
	if (parsed.mode === "rpc") {
		return "rpc";
	}
	if (parsed.mode === "json") {
		return "json";
	}
	if (parsed.goal || parsed.print || !stdinIsTTY || !stdoutIsTTY) {
		return "print";
	}
	return "interactive";
}

function toPrintOutputMode(appMode: AppMode): Exclude<Mode, "rpc"> {
	return appMode === "json" ? "json" : "text";
}

function isPlainRuntimeMetadataCommand(parsed: Args): boolean {
	return !parsed.print && parsed.mode === undefined && (parsed.help === true || parsed.listModels !== undefined);
}

async function prepareInitialMessage(
	parsed: Args,
	autoResizeImages: boolean,
	stdinContent?: string,
): Promise<{
	initialMessage?: string;
	initialImages?: ImageContent[];
}> {
	const { buildInitialMessage } = await import("./cli/initial-message.ts");
	if (parsed.fileArgs.length === 0) {
		return buildInitialMessage({ parsed, stdinContent });
	}

	const { processFileArguments } = await import("./cli/file-processor.ts");
	const { text, images } = await processFileArguments(parsed.fileArgs, { autoResizeImages });
	return buildInitialMessage({
		parsed,
		fileText: text,
		fileImages: images,
		stdinContent,
	});
}

/** Result from resolving a session argument */
type ResolvedSession =
	| { type: "path"; path: string } // Direct file path
	| { type: "local"; path: string } // Found in current project
	| { type: "global"; path: string; cwd: string } // Found in different project
	| { type: "not_found"; arg: string }; // Not found anywhere

/**
 * Resolve a session argument to a file path.
 * If it looks like a path, use as-is. Otherwise try to match as session ID prefix.
 */
async function findLocalSessionByExactId(
	sessionId: string,
	cwd: string,
	sessionDir?: string,
): Promise<{ type: "local"; path: string } | undefined> {
	const { SessionManager } = await import("./core/session-manager.ts");
	const localSessions = await SessionManager.list(cwd, sessionDir);
	const localMatch = localSessions.find((s) => s.id === sessionId);
	return localMatch ? { type: "local", path: localMatch.path } : undefined;
}

async function resolveSessionPath(sessionArg: string, cwd: string, sessionDir?: string): Promise<ResolvedSession> {
	const { resolvePath } = await import("./utils/paths.ts");
	const { SessionManager } = await import("./core/session-manager.ts");
	// If it looks like a file path, resolve it before handing it to the session manager.
	if (sessionArg.includes("/") || sessionArg.includes("\\") || sessionArg.endsWith(".jsonl")) {
		return { type: "path", path: resolvePath(sessionArg, cwd) };
	}

	// Try to match as session ID in current project first
	const localSessions = await SessionManager.list(cwd, sessionDir);
	const localMatch =
		localSessions.find((s) => s.id === sessionArg) ?? localSessions.find((s) => s.id.startsWith(sessionArg));

	if (localMatch) {
		return { type: "local", path: localMatch.path };
	}

	// Try global search across all projects
	const allSessions = await SessionManager.listAll(sessionDir);
	const globalMatch =
		allSessions.find((s) => s.id === sessionArg) ?? allSessions.find((s) => s.id.startsWith(sessionArg));

	if (globalMatch) {
		return { type: "global", path: globalMatch.path, cwd: globalMatch.cwd };
	}

	// Not found anywhere
	return { type: "not_found", arg: sessionArg };
}

/** Prompt user for yes/no confirmation */
async function promptConfirm(message: string): Promise<boolean> {
	const { createInterface } = await import("node:readline");
	return new Promise((resolve) => {
		const rl = createInterface({
			input: process.stdin,
			output: process.stdout,
		});
		rl.question(`${message} [y/N] `, (answer) => {
			rl.close();
			resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
		});
	});
}

function validateForkFlags(parsed: Args): void {
	if (!parsed.fork) return;

	const conflictingFlags = [
		parsed.session ? "--session" : undefined,
		parsed.continue ? "--continue" : undefined,
		parsed.resume ? "--resume" : undefined,
		parsed.noSession ? "--no-session" : undefined,
	].filter((flag): flag is string => flag !== undefined);

	if (conflictingFlags.length > 0) {
		console.error(chalk.red(`Error: --fork cannot be combined with ${conflictingFlags.join(", ")}`));
		process.exit(1);
	}
}

async function validateSessionIdFlags(parsed: Args): Promise<void> {
	if (parsed.sessionId === undefined) return;

	const conflictingFlags = [
		parsed.session ? "--session" : undefined,
		parsed.continue ? "--continue" : undefined,
		parsed.resume ? "--resume" : undefined,
		parsed.noSession ? "--no-session" : undefined,
	].filter((flag): flag is string => flag !== undefined);

	if (conflictingFlags.length > 0) {
		console.error(chalk.red(`Error: --session-id cannot be combined with ${conflictingFlags.join(", ")}`));
		process.exit(1);
	}

	const { assertValidSessionId } = await import("./core/session-manager.ts");
	try {
		assertValidSessionId(parsed.sessionId);
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(chalk.red(`Error: ${message}`));
		process.exit(1);
	}
}

async function forkSessionOrExit(sourcePath: string, cwd: string, sessionDir?: string, sessionId?: string) {
	const { SessionManager } = await import("./core/session-manager.ts");
	try {
		return SessionManager.forkFrom(sourcePath, cwd, sessionDir, { id: sessionId });
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(chalk.red(`Error: ${message}`));
		process.exit(1);
	}
}

async function createSessionManager(
	parsed: Args,
	cwd: string,
	sessionDir: string | undefined,
	settingsManager: SettingsManager,
) {
	const { SessionManager } = await import("./core/session-manager.ts");
	if (parsed.noSession || parsed.help || parsed.listModels !== undefined) {
		return SessionManager.inMemory(cwd);
	}

	if (parsed.fork) {
		if (parsed.sessionId) {
			const existingTarget = await findLocalSessionByExactId(parsed.sessionId, cwd, sessionDir);
			if (existingTarget) {
				console.error(chalk.red(`Session already exists with id '${parsed.sessionId}'`));
				process.exit(1);
			}
		}

		const resolved = await resolveSessionPath(parsed.fork, cwd, sessionDir);

		switch (resolved.type) {
			case "path":
			case "local":
			case "global":
				return forkSessionOrExit(resolved.path, cwd, sessionDir, parsed.sessionId);

			case "not_found":
				console.error(chalk.red(`No session found matching '${resolved.arg}'`));
				process.exit(1);
		}
	}

	if (parsed.session) {
		const resolved = await resolveSessionPath(parsed.session, cwd, sessionDir);

		switch (resolved.type) {
			case "path":
			case "local":
				return SessionManager.open(resolved.path, sessionDir);

			case "global": {
				console.log(chalk.yellow(`Session found in different project: ${resolved.cwd}`));
				const shouldFork = await promptConfirm("Fork this session into current directory?");
				if (!shouldFork) {
					console.log(chalk.dim("Aborted."));
					process.exit(0);
				}
				return forkSessionOrExit(resolved.path, cwd, sessionDir);
			}

			case "not_found":
				console.error(chalk.red(`No session found matching '${resolved.arg}'`));
				process.exit(1);
		}
	}

	if (parsed.resume) {
		const { initTheme, stopThemeWatcher } = await import("./modes/interactive/theme/theme.ts");
		const { selectSession } = await import("./cli/session-picker.ts");
		initTheme(settingsManager.getTheme(), true);
		try {
			const selectedPath = await selectSession(
				(onProgress) => SessionManager.list(cwd, sessionDir, onProgress),
				(onProgress) => SessionManager.listAll(sessionDir, onProgress),
			);
			if (!selectedPath) {
				console.log(chalk.dim("No session selected"));
				process.exit(0);
			}
			return SessionManager.open(selectedPath, sessionDir);
		} finally {
			stopThemeWatcher();
		}
	}

	if (parsed.continue) {
		return SessionManager.continueRecent(cwd, sessionDir);
	}

	if (parsed.sessionId) {
		const existingSession = await findLocalSessionByExactId(parsed.sessionId, cwd, sessionDir);
		if (existingSession) {
			return SessionManager.open(existingSession.path, sessionDir);
		}
	}

	return SessionManager.create(cwd, sessionDir, { id: parsed.sessionId });
}

export async function buildSessionOptions(
	parsed: Args,
	scopedModels: ScopedModel[],
	hasExistingSession: boolean,
	modelRegistry: ModelRegistry,
	settingsManager: SettingsManager,
): Promise<{
	options: CreateAgentSessionOptions;
	cliThinkingFromModel: boolean;
	diagnostics: AgentSessionRuntimeDiagnostic[];
}> {
	const { resolveCliModel } = await import("./core/model-resolver.ts");
	const { modelsAreEqual } = await import("@misul/ai");
	const { getPreset } = await import("./core/subagent/index.ts");
	const options: CreateAgentSessionOptions = {};
	const diagnostics: AgentSessionRuntimeDiagnostic[] = [];
	let cliThinkingFromModel = false;

	// Model from CLI
	// - supports --provider <name> --model <pattern>
	// - supports --model <provider>/<pattern>
	if (parsed.model) {
		const resolved = resolveCliModel({
			cliProvider: parsed.provider,
			cliModel: parsed.model,
			cliThinking: parsed.thinking,
			modelRegistry,
		});
		if (resolved.warning) {
			diagnostics.push({ type: "warning", message: resolved.warning });
		}
		if (resolved.error) {
			diagnostics.push({ type: "error", message: resolved.error });
		}
		if (resolved.model) {
			options.model = resolved.model;
			// Allow "--model <pattern>:<thinking>" as a shorthand.
			// Explicit --thinking still takes precedence (applied later).
			if (!parsed.thinking && resolved.thinkingLevel) {
				options.thinkingLevel = resolved.thinkingLevel;
				cliThinkingFromModel = true;
			}
		}
	}

	if (!options.model && scopedModels.length > 0 && !hasExistingSession) {
		// Check if saved default is in scoped models - use it if so, otherwise first scoped model
		const savedProvider = settingsManager.getDefaultProvider();
		const savedModelId = settingsManager.getDefaultModel();
		const savedModel = savedProvider && savedModelId ? modelRegistry.find(savedProvider, savedModelId) : undefined;
		const savedInScope = savedModel ? scopedModels.find((sm) => modelsAreEqual(sm.model, savedModel)) : undefined;

		if (savedInScope) {
			options.model = savedInScope.model;
			// Use thinking level from scoped model config if explicitly set
			if (!parsed.thinking && savedInScope.thinkingLevel) {
				options.thinkingLevel = savedInScope.thinkingLevel;
			}
		} else {
			options.model = scopedModels[0].model;
			// Use thinking level from first scoped model if explicitly set
			if (!parsed.thinking && scopedModels[0].thinkingLevel) {
				options.thinkingLevel = scopedModels[0].thinkingLevel;
			}
		}
	}

	// Thinking level from CLI (takes precedence over scoped model thinking levels set above)
	if (parsed.thinking) {
		options.thinkingLevel = parsed.thinking;
	}

	// Scoped models for Ctrl+P cycling
	// Keep thinking level undefined when not explicitly set in the model pattern.
	// Undefined means "inherit current session thinking level" during cycling.
	if (scopedModels.length > 0) {
		options.scopedModels = scopedModels.map((sm) => ({
			model: sm.model,
			thinkingLevel: sm.thinkingLevel,
		}));
	}

	// API key from CLI - set in authStorage
	// (handled by caller before createAgentSession)

	// Tools
	if (parsed.noTools) {
		options.noTools = "all";
	} else if (parsed.noBuiltinTools) {
		options.noTools = "builtin";
	}
	if (parsed.tools) {
		options.tools = [...parsed.tools];
	}
	if (parsed.excludeTools) {
		options.excludeTools = [...parsed.excludeTools];
	}

	// --agent <name>: run this session WITH the chosen agent persona and enable
	// subagent delegation (the spawn_agent tool). The persona system prompt is
	// appended via resourceLoaderOptions.appendSystemPrompt (see createRuntime).
	// --solo or soloMode setting overrides this and disables subagent spawning.
	const soloMode = parsed.solo || settingsManager.getSoloMode();
	if (soloMode) {
		options.enableSubagents = false;
	} else if (parsed.agent && getPreset(parsed.agent)) {
		options.enableSubagents = true;
		options.autoReviewSubagents = parsed.autoreview || settingsManager.getAutoReviewSubagents();
	}

	// Permission gate is always on. No flag, no setting.

	if (parsed.assistantPrefill !== undefined) {
		options.assistantPrefill = parsed.assistantPrefill;
	}

	return { options, cliThinkingFromModel, diagnostics };
}

async function resolveCliPaths(cwd: string, paths: string[] | undefined): Promise<string[] | undefined> {
	if (!paths) return undefined;
	const { isLocalPath, resolvePath } = await import("./utils/paths.ts");
	return paths.map((value) => (isLocalPath(value) ? resolvePath(value, cwd) : value));
}

async function promptForMissingSessionCwd(
	issue: SessionCwdIssue,
	settingsManager: SettingsManager,
): Promise<string | undefined> {
	const { showStartupSelector } = await import("./cli/startup-ui.ts");
	const { formatMissingSessionCwdPrompt } = await import("./core/session-cwd.ts");
	return showStartupSelector(settingsManager, formatMissingSessionCwdPrompt(issue), [
		{ label: "Continue", value: issue.fallbackCwd },
		{ label: "Cancel", value: undefined },
	]);
}

export interface MainOptions {
	extensionFactories?: ExtensionFactory[];
}

export async function main(args: string[], options?: MainOptions) {
	resetTimings();
	const offlineMode = args.includes("--offline") || getEnvFlag("OFFLINE");
	if (offlineMode) {
		process.env.MISUL_OFFLINE = "1";
		process.env.MISUL_SKIP_VERSION_CHECK = "1";
	}

	if (process.platform === "win32") {
		const { cleanupWindowsSelfUpdateQuarantine } = await import("./utils/windows-self-update.ts");
		cleanupWindowsSelfUpdateQuarantine(getPackageDir());
	}

	const cwd = process.cwd();
	const agentDir = getAgentDir();
	const bootstrapSettingsManager = SettingsManager.create(cwd, agentDir, { projectTrusted: false });
	applyHttpProxySettings(bootstrapSettingsManager.getGlobalSettings().httpProxy);
	configureHttpDispatcher(DEFAULT_HTTP_IDLE_TIMEOUT_MS, offlineMode ? { connectTimeoutMs: OFFLINE_CONNECT_TIMEOUT_MS } : undefined);

	const firstArg = args[0];
	if (firstArg === "addon" || firstArg === "addons") {
		const { handleAddonCommand } = await import("./addon-cli.ts");
		if (await handleAddonCommand(args)) {
			const exitCode = process.exitCode ?? 0;
			process.exit(exitCode);
			return;
		}
	}

	const pkgCommands = new Set(["install", "uninstall", "remove", "update", "list"]);
	if (firstArg === "config" || (firstArg && pkgCommands.has(firstArg))) {
		const { handleConfigCommand, handlePackageCommand } = await import("./package-manager-cli.ts");
		if (await handlePackageCommand(args, { extensionFactories: options?.extensionFactories })) {
			const exitCode = process.exitCode ?? 0;
			if (process.platform === "win32" && exitCode === 0 && args[0] === "update") {
				// We normally prefer process.exit(0) for package commands so bad extensions cannot keep
				// one-shot commands alive. On Windows, Node can assert after fetch() if process.exit(0)
				// runs during teardown; let successful `misul update` drain naturally instead.
				// https://github.com/nodejs/node/issues/56645
				return;
			}
			process.exit(exitCode);
			return;
		}

		if (await handleConfigCommand(args, { extensionFactories: options?.extensionFactories })) {
			return;
		}
	}

	const parsed = parseArgs(args);
	if (parsed.diagnostics.length > 0) {
		for (const d of parsed.diagnostics) {
			const color = d.type === "error" ? chalk.red : chalk.yellow;
			console.error(color(`${d.type === "error" ? "Error" : "Warning"}: ${d.message}`));
		}
		if (parsed.diagnostics.some((d) => d.type === "error")) {
			process.exit(1);
		}
	}
	time("parseArgs");

	if (parsed.agent) {
		const { getPreset } = await import("./core/subagent/index.ts");
		if (getPreset(parsed.agent)) {
			// --agent enables the chosen agent's persona + subagent delegation for this
			// session. TODO(user-decision): running the top-level session through the
			// full deep-work STRATEGY loop (spec -> plan -> execute -> review) is a
			// larger run-mode integration + UX decision; deferred (see plan SP9).
			console.error(`Running with the "${parsed.agent}" agent (subagent delegation enabled).`);
		}
	}

	if (parsed.version) {
		console.log(VERSION);
		process.exit(0);
	}

	if (parsed.export) {
		let result: string;
		try {
			const outputPath = parsed.messages.length > 0 ? parsed.messages[0] : undefined;
			const { exportFromFile } = await import("./core/export-html/index.ts");
			result = await exportFromFile(parsed.export, outputPath);
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : "Failed to export session";
			console.error(chalk.red(`Error: ${message}`));
			process.exit(1);
		}
		console.log(`Exported to: ${result}`);
		process.exit(0);
	}

	let appMode = resolveAppMode(parsed, process.stdin.isTTY, process.stdout.isTTY);
	const shouldTakeOverStdout = appMode !== "interactive" && !isPlainRuntimeMetadataCommand(parsed);
	if (shouldTakeOverStdout) {
		const { takeOverStdout } = await import("./core/output-guard.ts");
		takeOverStdout();
	}

	// Fast path for plain `--help` (text/interactive output to stdout): short-circuit
	// before any session/service/resource init. Building the full runtime loads
	// extensions, and an extension factory can do blocking network work during load
	// (perf bug P10), which would delay help by ~11s. Extension-contributed CLI flags
	// are omitted here; core help is complete and notes that extensions add flags.
	// The json/print-mode `--help` path is handled later, after stdout is taken over,
	// so machine-output modes keep stdout clean.
	if (parsed.help && isPlainRuntimeMetadataCommand(parsed)) {
		printHelp();
		process.exit(0);
	}

	if (parsed.mode === "rpc" && parsed.fileArgs.length > 0) {
		console.error(chalk.red("Error: @file arguments are not supported in RPC mode"));
		process.exit(1);
	}

	validateForkFlags(parsed);
	await validateSessionIdFlags(parsed);

	// Run migrations (pass cwd for project-local migrations)
	const { runMigrations } = await import("./migrations.ts");
	const { migratedAuthProviders: migratedProviders, deprecationWarnings } = runMigrations(cwd);
	time("runMigrations");

	const startupSettingsManager = SettingsManager.create(cwd, agentDir);
	reportDiagnostics(collectSettingsDiagnostics(startupSettingsManager, "startup session lookup"));

	// Experimental first-time setup: theme choice and analytics opt-in.
	// Runs before any runtime services are created so the chosen settings apply everywhere.
	if (appMode === "interactive" && !parsed.help && parsed.listModels === undefined) {
		const { shouldRunFirstTimeSetup, showFirstTimeSetup } = await import("./cli/startup-ui.ts");
		if (shouldRunFirstTimeSetup()) {
			await showFirstTimeSetup(startupSettingsManager);
			time("firstTimeSetup");
		}
	}

	// Decide the final runtime cwd before creating cwd-bound runtime services.
	// --session and --resume may select a session from another project, so project-local
	// settings, resources, provider registrations, and models must be resolved only after
	// the target session cwd is known. The startup-cwd settings manager is used only for
	// sessionDir lookup during session selection.
	const envSessionDir = process.env[ENV_SESSION_DIR];
	const { normalizePath } = await import("./utils/paths.ts");
	const sessionDir =
		(parsed.sessionDir ? normalizePath(parsed.sessionDir) : undefined) ??
		(envSessionDir ? expandTildePath(envSessionDir) : undefined) ??
		startupSettingsManager.getSessionDir();
	let sessionManager = await createSessionManager(parsed, cwd, sessionDir, startupSettingsManager);
	const { getMissingSessionCwdIssue } = await import("./core/session-cwd.ts");
	const missingSessionCwdIssue = getMissingSessionCwdIssue(sessionManager, cwd);
	if (missingSessionCwdIssue) {
		if (appMode === "interactive") {
			const selectedCwd = await promptForMissingSessionCwd(missingSessionCwdIssue, startupSettingsManager);
			if (!selectedCwd) {
				process.exit(0);
			}
			const { SessionManager } = await import("./core/session-manager.ts");
			sessionManager = SessionManager.open(missingSessionCwdIssue.sessionFile!, sessionDir, selectedCwd);
		} else {
			const { MissingSessionCwdError } = await import("./core/session-cwd.ts");
			console.error(chalk.red(new MissingSessionCwdError(missingSessionCwdIssue).message));
			process.exit(1);
		}
	}
	if (parsed.name !== undefined) {
		const name = parsed.name.trim();
		if (!name) {
			console.error(chalk.red("Error: --name requires a non-empty value"));
			process.exit(1);
		}
		sessionManager.appendSessionInfo(name);
	}
	time("createSessionManager");

	const { ProjectTrustStore, hasTrustRequiringProjectResources } = await import("./core/trust-manager.ts");
	const trustStore = new ProjectTrustStore(agentDir);
	const sessionCwd = sessionManager.getCwd();
	const autoTrustOnReloadCwd =
		parsed.projectTrustOverride === undefined && !hasTrustRequiringProjectResources(sessionCwd)
			? sessionCwd
			: undefined;
	const trustPromptMode: AppMode = parsed.help || parsed.listModels !== undefined ? "print" : appMode;
	const projectTrustByCwd = new Map<string, boolean>();

	const resolvedExtensionPaths = await resolveCliPaths(cwd, parsed.extensions);
	const resolvedSkillPaths = await resolveCliPaths(cwd, parsed.skills);
	const resolvedPromptTemplatePaths = await resolveCliPaths(cwd, parsed.promptTemplates);
	const resolvedThemePaths = await resolveCliPaths(cwd, parsed.themes);
	const resolvedAddonPaths = await resolveCliPaths(cwd, parsed.addons);
	const { AuthStorage } = await import("./core/auth-storage.ts");
	const authStorage = AuthStorage.create();
	const createRuntime: CreateAgentSessionRuntimeFactory = async ({
		cwd,
		agentDir,
		sessionManager,
		sessionStartEvent,
		projectTrustContext,
	}) => {
		const { createAgentSessionServices, createAgentSessionFromServices } = await import("./core/agent-session-services.ts");
		const { resolveProjectTrusted } = await import("./core/project-trust.ts");
		const { createProjectTrustContext } = await import("./cli/project-trust.ts");
		const { getPreset } = await import("./core/subagent/index.ts");
		const isInitialRuntime = sessionStartEvent === undefined;
		const projectTrustDiagnostics: AgentSessionRuntimeDiagnostic[] = [];
		const cachedProjectTrust = projectTrustByCwd.get(cwd);
		const hasTrustRequiringResources = hasTrustRequiringProjectResources(cwd);
		const shouldResolveProjectTrust =
			parsed.projectTrustOverride === undefined && cachedProjectTrust === undefined && hasTrustRequiringResources;
		const projectTrusted = shouldResolveProjectTrust
			? false
			: (cachedProjectTrust ??
				parsed.projectTrustOverride ??
				(!hasTrustRequiringResources || trustStore.get(cwd) === true));
		const runtimeSettingsManager = SettingsManager.create(cwd, agentDir, { projectTrusted });
		// --agent <name>: append the chosen preset's persona to the system prompt
		// (subagent delegation itself is enabled via enableSubagents below).
		const agentPreset = parsed.agent ? getPreset(parsed.agent) : undefined;
		const appendSystemPrompt = agentPreset
			? [...(parsed.appendSystemPrompt ?? []), agentPreset.systemPrompt]
			: parsed.appendSystemPrompt;
		const services = await createAgentSessionServices({
			cwd,
			agentDir,
			authStorage,
			settingsManager: runtimeSettingsManager,
			extensionFlagValues: parsed.unknownFlags,
			resourceLoaderReloadOptions: shouldResolveProjectTrust
				? {
						resolveProjectTrust: async ({ extensionsResult }) => {
							const trusted = await resolveProjectTrusted({
								cwd,
								trustStore,
								trustOverride: parsed.projectTrustOverride,
								defaultProjectTrust: startupSettingsManager.getDefaultProjectTrust(),
								extensionsResult,
								projectTrustContext:
									projectTrustContext ??
									createProjectTrustContext({
										cwd,
										mode: isInitialRuntime ? trustPromptMode : appMode,
										settingsManager: startupSettingsManager,
										hasUI: isInitialRuntime && trustPromptMode === "interactive",
									}),
								onExtensionError: (message) => projectTrustDiagnostics.push({ type: "warning", message }),
							});
							projectTrustByCwd.set(cwd, trusted);
							return trusted;
						},
					}
				: undefined,
			resourceLoaderOptions: {
				additionalExtensionPaths: resolvedExtensionPaths,
				additionalSkillPaths: resolvedSkillPaths,
				additionalPromptTemplatePaths: resolvedPromptTemplatePaths,
				additionalThemePaths: resolvedThemePaths,
				additionalAddonPaths: resolvedAddonPaths,
				noExtensions: parsed.noExtensions,
				noSkills: parsed.noSkills,
				noPromptTemplates: parsed.noPromptTemplates,
				noThemes: parsed.noThemes,
				noContextFiles: parsed.noContextFiles,
				systemPrompt: parsed.systemPrompt,
				appendSystemPrompt,
				extensionFactories: options?.extensionFactories,
			},
		});
		const { settingsManager, modelRegistry, resourceLoader } = services;
		const diagnostics: AgentSessionRuntimeDiagnostic[] = [
			...projectTrustDiagnostics,
			...services.diagnostics,
			...collectSettingsDiagnostics(settingsManager, "runtime creation"),
			...resourceLoader.getExtensions().errors.map(({ path, error }) => ({
				type: "error" as const,
				message: `Failed to load extension "${path}": ${error}`,
			})),
		];

		if (parsed.laplace) {
			const laplace = await import("@misul/ai");
			const modelPath = parsed.laplaceModel ?? laplace.resolveLaplaceModelPath();
			if (!modelPath) {
				diagnostics.push({
					type: "error" as const,
					message: "--laplace requires a model path. Use --laplace-model <path>, set MISUL_LAPLACE_MODEL, or place a .gguf file in ~/Projects/Laplace/models/.",
				});
			} else {
				const binaryPath = laplace.resolveLaplaceBinaryPath();
				const maxTokens = process.env.MISUL_LAPLACE_MAX_TOKENS
					? parseInt(process.env.MISUL_LAPLACE_MAX_TOKENS, 10)
					: laplace.LAPLACE_DEFAULT_MAX_TOKENS;
				const extraArgs = process.env.MISUL_LAPLACE_EXTRA_ARGS
					? process.env.MISUL_LAPLACE_EXTRA_ARGS.split(" ").filter(Boolean)
					: [];
				modelRegistry.registerProvider(laplace.LAPLACE_PROVIDER, {
					baseUrl: "http://localhost:0",
					apiKey: "local",
					api: laplace.LAPLACE_API,
					streamSimple: laplace.createLaplaceStreamSimple({ binaryPath, modelPath, maxTokens, extraArgs }),
					models: [
						{
							id: laplace.LAPLACE_MODEL_ID,
							name: "Laplace Local",
							reasoning: false,
							input: ["text"],
							cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
							contextWindow: laplace.LAPLACE_DEFAULT_CONTEXT_WINDOW,
							maxTokens,
						},
					],
				});
				parsed.provider = laplace.LAPLACE_PROVIDER;
				parsed.model = laplace.LAPLACE_MODEL_ID;
			}
		}

		const { resolveModelScope } = await import("./core/model-resolver.ts");
		const modelPatterns = parsed.models ?? settingsManager.getEnabledModels();
		const scopedModels =
			modelPatterns && modelPatterns.length > 0 ? await resolveModelScope(modelPatterns, modelRegistry) : [];
		const {
			options: sessionOptions,
			cliThinkingFromModel,
			diagnostics: sessionOptionDiagnostics,
		} = await buildSessionOptions(
			parsed,
			scopedModels,
			sessionManager.buildSessionContext().messages.length > 0,
			modelRegistry,
			settingsManager,
		);
		diagnostics.push(...sessionOptionDiagnostics);

		if (parsed.apiKey) {
			if (!sessionOptions.model) {
				diagnostics.push({
					type: "error",
					message: "--api-key requires a model to be specified via --model, --provider/--model, or --models",
				});
			} else {
				authStorage.setRuntimeApiKey(sessionOptions.model.provider, parsed.apiKey);
			}
		}

		const created = await createAgentSessionFromServices({
			services,
			sessionManager,
			sessionStartEvent,
			model: sessionOptions.model,
			thinkingLevel: sessionOptions.thinkingLevel,
			scopedModels: sessionOptions.scopedModels,
			tools: sessionOptions.tools,
			excludeTools: sessionOptions.excludeTools,
			noTools: sessionOptions.noTools,
			customTools: sessionOptions.customTools,
			enableSubagents: sessionOptions.enableSubagents,
			autoReviewSubagents: sessionOptions.autoReviewSubagents,
		});
		const cliThinkingOverride = parsed.thinking !== undefined || cliThinkingFromModel;
		if (created.session.model && cliThinkingOverride) {
			created.session.setThinkingLevel(created.session.thinkingLevel);
		}

		return {
			...created,
			services,
			diagnostics,
		};
	};
	time("createRuntime");
	const { createAgentSessionRuntime } = await import("./core/agent-session-runtime.ts");
	const runtime = await createAgentSessionRuntime(createRuntime, {
		cwd: sessionManager.getCwd(),
		agentDir,
		sessionManager,
	});
	time("createAgentSessionRuntime");
	const { services, session, modelFallbackMessage } = runtime;
	const { settingsManager, modelRegistry, resourceLoader } = services;
	applyHttpProxySettings(settingsManager.getGlobalSettings().httpProxy);
	configureHttpDispatcher(
		settingsManager.getHttpIdleTimeoutMs(),
		offlineMode ? { connectTimeoutMs: OFFLINE_CONNECT_TIMEOUT_MS } : undefined,
	);

	if (parsed.help) {
		const extensionFlags = resourceLoader
			.getExtensions()
			.extensions.flatMap((extension) => Array.from(extension.flags.values()));
		printHelp(extensionFlags);
		process.exit(0);
	}

	if (parsed.listModels !== undefined) {
		const { listModels } = await import("./cli/list-models.ts");
		const searchPattern = typeof parsed.listModels === "string" ? parsed.listModels : undefined;
		await listModels(modelRegistry, searchPattern);
		process.exit(0);
	}

	// Read piped stdin content (if any) - skip for RPC mode which uses stdin for JSON-RPC
	let stdinContent: string | undefined;
	if (appMode !== "rpc") {
		stdinContent = await readPipedStdin();
		if (stdinContent !== undefined && appMode === "interactive") {
			appMode = "print";
		}
	}
	time("readPipedStdin");

	const { initialMessage, initialImages } = await prepareInitialMessage(
		parsed,
		settingsManager.getImageAutoResize(),
		stdinContent,
	);
	time("prepareInitialMessage");
	const { initTheme } = await import("./modes/interactive/theme/theme.ts");
	initTheme(settingsManager.getTheme(), appMode === "interactive");
	time("initTheme");

	// Show deprecation warnings in interactive mode
	if (appMode === "interactive" && deprecationWarnings.length > 0) {
		const { showDeprecationWarnings } = await import("./migrations.ts");
		await showDeprecationWarnings(deprecationWarnings);
	}

	time("resolveModelScope");
	reportDiagnostics(runtime.diagnostics);
	if (runtime.diagnostics.some((diagnostic) => diagnostic.type === "error")) {
		process.exit(1);
	}
	time("createAgentSession");

	if (appMode !== "interactive" && !session.model) {
		const { formatNoModelsAvailableMessage } = await import("./core/auth-guidance.ts");
		console.error(chalk.red(formatNoModelsAvailableMessage()));
		process.exit(1);
	}

	const startupBenchmark = getEnvFlag("STARTUP_BENCHMARK");
	if (startupBenchmark && appMode !== "interactive") {
		console.error(chalk.red("Error: MISUL_STARTUP_BENCHMARK only supports interactive mode"));
		process.exit(1);
	}

	const { stopThemeWatcher } = await import("./modes/interactive/theme/theme.ts");
	const { restoreStdout } = await import("./core/output-guard.ts");
	if (appMode === "rpc") {
		const { runRpcMode } = await import("./modes/index.ts");
		printTimings();
		await runRpcMode(runtime);
	} else if (appMode === "interactive") {
		const { InteractiveMode } = await import("./modes/index.ts");
		const interactiveMode = new InteractiveMode(runtime, {
			migratedProviders,
			modelFallbackMessage,
			autoTrustOnReloadCwd,
			initialMessage,
			initialImages,
			initialMessages: parsed.messages,
			verbose: parsed.verbose,
		});
		if (startupBenchmark) {
			await interactiveMode.init();
			time("interactiveMode.init");
			printTimings();
			interactiveMode.stop();
			stopThemeWatcher();
			if (process.stdout.writableLength > 0) {
				await new Promise<void>((resolve) => process.stdout.once("drain", resolve));
			}
			if (process.stderr.writableLength > 0) {
				await new Promise<void>((resolve) => process.stderr.once("drain", resolve));
			}
			return;
		}

		printTimings();
		await interactiveMode.run();
	} else {
		printTimings();

		if (parsed.goal) {
			const { runGoalLoop } = await import("./core/goal-loop.ts");
			const model = session.agent.state.model;
			if (!model) {
				console.error("No model selected.");
				process.exit(1);
			}
			const abortController = new AbortController();
			process.on("SIGINT", () => abortController.abort());
			const guidelines = [
				resourceLoader.getSystemPrompt(),
				...resourceLoader.getAgentsFiles().agentsFiles.map((f) => f.content),
			].filter(Boolean).join("\n\n") || undefined;
			const result = await runGoalLoop({
				goal: parsed.goal,
				guidelines,
				model,
				cwd: sessionManager.getCwd(),
				signal: abortController.signal,
				thinkingLevel: session.thinkingLevel,
				prompt: (text) => session.prompt(text),
				getLastResponse: () => {
					const msgs = session.agent.state.messages;
					for (let i = msgs.length - 1; i >= 0; i--) {
						const m = msgs[i];
						if (m.role === "assistant") {
							const content = m.content;
							if (Array.isArray(content)) {
								return content
									.filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
									.map((b) => b.text)
									.join("\n");
							}
						}
					}
					return undefined;
				},
				getToolCallCount: () => {
					let count = 0;
					for (const m of session.agent.state.messages) {
						if (m.role === "assistant" && Array.isArray(m.content)) {
							count += m.content.filter((b) => b.type === "toolCall").length;
						}
					}
					return count;
				},
				getLastTurnSignature: () => {
					const msgs = session.agent.state.messages;
					for (let i = msgs.length - 1; i >= 0; i--) {
						const m = msgs[i];
						if (m.role !== "assistant" || !Array.isArray(m.content)) continue;
						const calls = m.content.filter((b) => b.type === "toolCall");
						if (calls.length === 0) continue;
						return calls
							.map((c) => {
								const tc = c as Extract<typeof c, { type: "toolCall" }>;
								return `${tc.name}:${JSON.stringify(tc.arguments).slice(0, 200)}`;
							})
							.join("|");
					}
					return "";
				},
				getStats: () => {
					const stats = session.getSessionStats();
					return { cost: stats.cost, tokens: stats.tokens };
				},
				onStatus: (status) => console.error(`[goal] ${status}`),
			});
			console.error(
				`[goal] ${result.finalStatus} (${result.iterations} iterations, ${result.thinkingRounds} thinking rounds, $${result.costUsd.toFixed(4)})`,
			);
			stopThemeWatcher();
			restoreStdout();
			process.exitCode = result.achieved ? 0 : 1;
			return;
		}

		const { runPrintMode } = await import("./modes/index.ts");
		const exitCode = await runPrintMode(runtime, {
			mode: toPrintOutputMode(appMode),
			messages: parsed.messages,
			initialMessage,
			initialImages,
		});
		stopThemeWatcher();
		restoreStdout();
		if (exitCode !== 0) {
			process.exitCode = exitCode;
		}
		return;
	}
}
