/**
 * CLI handler for `misul addon <command>`.
 *
 * Commands:
 *   misul addon install <source> [-l]   Install an addon from git/npm/local
 *   misul addon remove <name>   [-l]   Remove an installed addon
 *   misul addon list                   List installed addons
 *   misul addon search [query]         Search the addon store registry
 *   misul addon store                  List all addons in the store
 */

import chalk from "chalk";
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { getGlobalAddonsDir } from "./core/addons.ts";
import { installAddon } from "./core/addon-installer.ts";
import { DEFAULT_ADDON_STORE_URL, fetchAddonStore, searchAddons } from "./core/addon-store.ts";
import { getAgentDir, APP_NAME } from "./config.ts";
import { SettingsManager } from "./core/settings-manager.ts";

export type AddonCommand = "install" | "remove" | "list" | "search" | "store";

interface AddonCommandOptions {
	command: AddonCommand;
	source?: string;
	local: boolean;
	help: boolean;
	invalidOption?: string;
	invalidArgument?: string;
	missingSource?: boolean;
}

function getAddonCommandUsage(command: AddonCommand): string {
	switch (command) {
		case "install":
			return `${APP_NAME} addon install <source> [-l]`;
		case "remove":
			return `${APP_NAME} addon remove <name> [-l]`;
		case "list":
			return `${APP_NAME} addon list`;
		case "search":
			return `${APP_NAME} addon search [query]`;
		case "store":
			return `${APP_NAME} addon store`;
	}
}

function printAddonCommandHelp(command: AddonCommand): void {
	switch (command) {
		case "install":
			console.log(`${chalk.bold("Usage:")}
  ${getAddonCommandUsage("install")}

Install an addon from a git, npm, or local source.

Options:
  -l, --local    Install project-locally (.misul/addons/)

Sources:
  git:github.com/user/repo        Git clone (shallow)
  git:git@github.com:user/repo    Git clone via SSH
  https://github.com/user/repo    Git clone via HTTPS
  npm:@scope/package              npm pack + extract
  ./local/path                    Symlink (or copy on Windows)

Examples:
  ${APP_NAME} addon install git:github.com/foo/my-addon
  ${APP_NAME} addon install npm:@foo/misul-tools
  ${APP_NAME} addon install ./my-local-addon -l
`);
			return;
		case "remove":
			console.log(`${chalk.bold("Usage:")}
  ${getAddonCommandUsage("remove")}

Remove an installed addon by name.

Options:
  -l, --local    Remove from project addons (.misul/addons/)

Examples:
  ${APP_NAME} addon remove my-addon
  ${APP_NAME} addon remove my-addon -l
`);
			return;
		case "list":
			console.log(`${chalk.bold("Usage:")}
  ${getAddonCommandUsage("list")}

List addons installed in user and project addon directories.
`);
			return;
		case "search":
			console.log(`${chalk.bold("Usage:")}
  ${getAddonCommandUsage("search")}

Search the addon store registry. Query matches name, description, and tags.
With no query, lists all store entries.

Examples:
  ${APP_NAME} addon search
  ${APP_NAME} addon search python
  ${APP_NAME} addon search "code review"
`);
			return;
		case "store":
			console.log(`${chalk.bold("Usage:")}
  ${getAddonCommandUsage("store")}

List all addons available in the store registry.
`);
			return;
	}
}

function parseAddonCommand(args: string[]): AddonCommandOptions | undefined {
	const [subcommand, ...rest] = args;
	let command: AddonCommand | undefined;
	if (subcommand === "install" || subcommand === "remove" || subcommand === "list" || subcommand === "search" || subcommand === "store") {
		command = subcommand;
	}
	if (!command) {
		return undefined;
	}

	let local = false;
	let help = false;
	let invalidOption: string | undefined;
	let invalidArgument: string | undefined;
	let source: string | undefined;

	for (const arg of rest) {
		if (arg === "-h" || arg === "--help") {
			help = true;
			continue;
		}
		if (arg === "-l" || arg === "--local") {
			if (command === "install" || command === "remove") {
				local = true;
			} else {
				invalidOption = invalidOption ?? arg;
			}
			continue;
		}
		if (arg.startsWith("-")) {
			invalidOption = invalidOption ?? arg;
			continue;
		}
		if (!source) {
			source = arg;
		} else {
			invalidArgument = invalidArgument ?? arg;
		}
	}

	return {
		command,
		source,
		local,
		help,
		invalidOption,
		invalidArgument,
		missingSource: false,
	};
}

function getAddonTargetDir(agentDir: string, cwd: string, local: boolean): string {
	if (local) {
		return join(cwd, ".misul", "addons");
	}
	return getGlobalAddonsDir(agentDir);
}

function listInstalledAddons(dir: string): Array<{ name: string; path: string }> {
	if (!existsSync(dir)) return [];
	const results: Array<{ name: string; path: string }> = [];
	for (const entry of readdirSync(dir)) {
		const addonPath = join(dir, entry);
		if (statSync(addonPath).isDirectory()) {
			results.push({ name: entry, path: addonPath });
		}
	}
	return results;
}

export async function handleAddonCommand(args: string[]): Promise<boolean> {
	if (args[0] !== "addon" && args[0] !== "addons") {
		return false;
	}

	const options = parseAddonCommand(args.slice(1));
	if (!options) {
		console.error(chalk.red(`Unknown addon command. Use: ${APP_NAME} addon install|remove|list|search|store`));
		process.exitCode = 1;
		return true;
	}

	if (options.help) {
		printAddonCommandHelp(options.command);
		return true;
	}

	if (options.invalidOption) {
		console.error(chalk.red(`Unknown option ${options.invalidOption} for "addon ${options.command}".`));
		console.error(chalk.dim(`Usage: ${getAddonCommandUsage(options.command)}`));
		process.exitCode = 1;
		return true;
	}

	if (options.invalidArgument) {
		console.error(chalk.red(`Unexpected argument ${options.invalidArgument}.`));
		console.error(chalk.dim(`Usage: ${getAddonCommandUsage(options.command)}`));
		process.exitCode = 1;
		return true;
	}

	const cwd = process.cwd();
	const agentDir = getAgentDir();
	const settingsManager = SettingsManager.create(cwd, agentDir);

	switch (options.command) {
		case "install": {
			if (!options.source) {
				console.error(chalk.red("Missing addon source."));
				console.error(chalk.dim(`Usage: ${getAddonCommandUsage("install")}`));
				process.exitCode = 1;
				return true;
			}
			const targetDir = getAddonTargetDir(agentDir, cwd, options.local);
			console.log(chalk.dim(`Installing addon from ${options.source}...`));
			const result = await installAddon(options.source, targetDir);
			if (!result.success) {
				console.error(chalk.red(`Failed to install addon: ${result.error}`));
				process.exitCode = 1;
				return true;
			}
			// Persist source in settings for tracking
			const addons = settingsManager.getAddons();
			if (!addons.includes(options.source)) {
				addons.push(options.source);
				if (options.local) {
					settingsManager.setProjectAddons(addons);
				} else {
					settingsManager.setAddons(addons);
				}
			}
			console.log(chalk.green(`Installed addon "${result.name}" -> ${result.path}`));
			return true;
		}

		case "remove": {
			if (!options.source) {
				console.error(chalk.red("Missing addon name."));
				console.error(chalk.dim(`Usage: ${getAddonCommandUsage("remove")}`));
				process.exitCode = 1;
				return true;
			}
			const targetDir = getAddonTargetDir(agentDir, cwd, options.local);
			const addonPath = join(targetDir, options.source);
			if (!existsSync(addonPath)) {
				console.error(chalk.red(`Addon "${options.source}" not found in ${targetDir}`));
				process.exitCode = 1;
				return true;
			}
			rmSync(addonPath, { recursive: true, force: true });
			// Remove from settings tracking
			const addons = settingsManager.getAddons().filter((s) => s !== options.source);
			if (options.local) {
				settingsManager.setProjectAddons(addons);
			} else {
				settingsManager.setAddons(addons);
			}
			console.log(chalk.green(`Removed addon "${options.source}"`));
			return true;
		}

		case "list": {
			const globalDir = getGlobalAddonsDir(agentDir);
			const projectDir = join(cwd, ".misul", "addons");
			const globalAddons = listInstalledAddons(globalDir);
			const projectAddons = listInstalledAddons(projectDir);

			if (globalAddons.length === 0 && projectAddons.length === 0) {
				console.log(chalk.dim("No addons installed."));
				console.log(chalk.dim(`Use "${APP_NAME} addon search" to browse available addons.`));
				return true;
			}

			if (globalAddons.length > 0) {
				console.log(chalk.bold("User addons:"));
				for (const addon of globalAddons) {
					console.log(`  ${addon.name}`);
					console.log(chalk.dim(`    ${addon.path}`));
				}
			}

			if (projectAddons.length > 0) {
				if (globalAddons.length > 0) console.log();
				console.log(chalk.bold("Project addons:"));
				for (const addon of projectAddons) {
					console.log(`  ${addon.name}`);
					console.log(chalk.dim(`    ${addon.path}`));
				}
			}
			return true;
		}

		case "search":
		case "store": {
			const storeUrl = settingsManager.getAddonStoreUrl() ?? DEFAULT_ADDON_STORE_URL;
			console.log(chalk.dim(`Fetching addon store from ${storeUrl}...`));
			const store = await fetchAddonStore(storeUrl);

			if (store.addons.length === 0) {
				console.log(chalk.dim("No addons found in the store."));
				console.log(chalk.dim(`The store may be unreachable or empty. Check the URL or try again later.`));
				return true;
			}

			const query = options.source ?? "";
			const results = options.command === "store" ? store.addons : searchAddons(store, query);

			if (results.length === 0) {
				console.log(chalk.dim(`No addons matching "${query}".`));
				return true;
			}

			console.log(chalk.bold(`${results.length} addon${results.length > 1 ? "s" : ""}${query ? ` matching "${query}"` : ""}:`));
			console.log();
			for (const entry of results) {
				console.log(`  ${chalk.bold(entry.name)} ${chalk.dim(`(${entry.source})`)}`);
				if (entry.description) {
					console.log(chalk.dim(`    ${entry.description}`));
				}
				if (entry.tags && entry.tags.length > 0) {
					console.log(chalk.dim(`    tags: ${entry.tags.join(", ")}`));
				}
			}
			console.log();
			console.log(chalk.dim(`Install with: ${APP_NAME} addon install <source>`));
			return true;
		}
	}
}
