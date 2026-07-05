import { existsSync, realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { Spacer, Text, type Container } from "@misul/tui";
import { theme } from "../modes/interactive/theme/theme.ts";
import { resolveToCwd } from "./tools/path-utils.ts";
import { getCwdRelativePath } from "../utils/paths.ts";
import { detectLineEnding, normalizeToLF, restoreLineEndings, stripBom } from "./tools/edit-diff.ts";
import { writeFileAtomic } from "./tools/atomic-write.ts";

function resolveInCwd(rawPath: string, cwd: string): string {
	const resolved = resolveToCwd(rawPath, cwd);
	const realCwd = realpathSync(cwd);
	const realPath = existsSync(resolved) ? realpathSync(resolved) : resolved;
	const relativePath = getCwdRelativePath(realPath, realCwd);
	if (relativePath === undefined) {
		throw new Error("Path must be inside the project directory");
	}
	return realPath;
}

export interface InstantToolContext {
	cwd: string;
	chatContainer: Container;
	requestRender: () => void;
	showError: (message: string) => void;
	showStatus: (message: string) => void;
	getTodos: () => string[];
	setTodos: (todos: string[]) => void;
}

function parseCommandArgs(input: string): { command: string; args: string[] } {
	const trimmed = input.trim();
	const parts: string[] = [];
	let current = "";
	let inQuotes = false;
	let quoteChar = "";

	for (let i = 0; i < trimmed.length; i++) {
		const char = trimmed[i];
		if (!inQuotes && (char === '"' || char === "'")) {
			inQuotes = true;
			quoteChar = char;
		} else if (inQuotes && char === quoteChar) {
			inQuotes = false;
			quoteChar = "";
		} else if (!inQuotes && /\s/.test(char)) {
			if (current.length > 0) {
				parts.push(current);
				current = "";
			}
		} else {
			current += char;
		}
	}
	if (current.length > 0) {
		parts.push(current);
	}

	const command = parts[0]?.replace(/^\//, "") ?? "";
	return { command, args: parts.slice(1) };
}

async function handleReadCommand(args: string[], ctx: InstantToolContext): Promise<void> {
	if (args.length === 0) {
		ctx.showError("Usage: /read <path>");
		return;
	}
	const rawPath = args[0];
	try {
		const absolutePath = resolveInCwd(rawPath, ctx.cwd);
		const content = await readFile(absolutePath, "utf8");
		const lines = content.split("\n");
		const maxLines = 200;
		const displayLines = lines.slice(0, maxLines);
		const remaining = Math.max(0, lines.length - maxLines);
		let text = `${theme.bold("read")} ${theme.fg("accent", absolutePath)}\n\n${displayLines.join("\n")}`;
		if (remaining > 0) {
			text += `\n\n${theme.fg("warning", `[Truncated: ${remaining} more lines]`)}`;
		}
		ctx.chatContainer.addChild(new Spacer(1));
		ctx.chatContainer.addChild(new Text(text, 0, 0));
		ctx.requestRender();
	} catch (error) {
		ctx.showError(`Failed to read ${rawPath}: ${error instanceof Error ? error.message : String(error)}`);
	}
}

async function handleGrepCommand(args: string[], ctx: InstantToolContext): Promise<void> {
	if (args.length === 0) {
		ctx.showError("Usage: /grep <pattern> [path]");
		return;
	}
	const [pattern, rawPath = "."] = args;
	const { spawn } = await import("child_process");
	let absolutePath: string;
	try {
		absolutePath = resolveInCwd(rawPath, ctx.cwd);
	} catch (error) {
		ctx.showError(error instanceof Error ? error.message : String(error));
		return;
	}
	const results: string[] = [];
	let truncated = false;
	let stderr = "";

	try {
		await new Promise<void>((resolve, reject) => {
			const proc = spawn(
				"rg",
				["--line-number", "--color=never", "--no-heading", "-n", "--", pattern, absolutePath],
				{ cwd: ctx.cwd, stdio: ["ignore", "pipe", "pipe"] },
			);
			proc.stdout.on("data", (data: Buffer) => {
				for (const line of data.toString("utf8").split("\n")) {
					if (!line.trim()) continue;
					if (results.length >= 100) {
						truncated = true;
						continue;
					}
					results.push(line);
				}
			});
			proc.stderr.on("data", (data: Buffer) => {
				stderr += data.toString("utf8");
			});
			proc.on("error", (error) => reject(error));
			proc.on("close", (code) => {
				if (code === 0 || code === 1) {
					resolve();
				} else {
					reject(new Error(stderr.trim() || `rg exited with code ${code}`));
				}
			});
		});
	} catch (error) {
		ctx.showError(`grep failed: ${error instanceof Error ? error.message : String(error)}`);
		return;
	}

	let text = `${theme.bold("grep")} ${theme.fg("accent", pattern)}${rawPath ? ` in ${theme.fg("accent", rawPath)}` : ""}`;
	if (results.length === 0) {
		text += "\n\nNo matches.";
	} else {
		text += "\n\n" + results.join("\n");
		if (truncated) {
			text += `\n${theme.fg("warning", "[Truncated: more than 100 matches]")}`;
		}
	}
	ctx.chatContainer.addChild(new Spacer(1));
	ctx.chatContainer.addChild(new Text(text, 0, 0));
	ctx.requestRender();
}

async function handleEditCommand(args: string[], ctx: InstantToolContext): Promise<void> {
	if (args.length < 3) {
		ctx.showError('Usage: /edit <path> "<oldText>" "<newText>"');
		return;
	}
	const rawPath = args[0];
	const oldText = args[1];
	const newText = args[2];
	if (oldText.length === 0) {
		ctx.showError("Old text cannot be empty.");
		return;
	}
	try {
		const absolutePath = resolveInCwd(rawPath, ctx.cwd);
		const raw = await readFile(absolutePath);
		const { bom, text } = stripBom(raw.toString("utf8"));
		if (!text.includes(oldText)) {
			ctx.showError(`Old text not found in ${rawPath}.`);
			return;
		}
		if (text.split(oldText).length - 1 > 1) {
			ctx.showError(`Old text is not unique in ${rawPath}.`);
			return;
		}
		const lineEnding = detectLineEnding(text);
		const normalized = normalizeToLF(text);
		const replaced = normalized.replace(oldText, newText);
		const output = bom + restoreLineEndings(replaced, lineEnding);
		await writeFileAtomic(absolutePath, output);
		ctx.chatContainer.addChild(new Spacer(1));
		ctx.chatContainer.addChild(
			new Text(`${theme.bold("edit")} ${theme.fg("accent", absolutePath)}\n\n${theme.fg("success", "Updated successfully.")}`, 0, 0),
		);
		ctx.requestRender();
	} catch (error) {
		ctx.showError(`Failed to edit ${rawPath}: ${error instanceof Error ? error.message : String(error)}`);
	}
}

function handleTodoCommand(args: string[], ctx: InstantToolContext): void {
	if (args.length === 0) {
		const todos = ctx.getTodos();
		let text = `${theme.bold("Todo list")}`;
		if (todos.length === 0) {
			text += "\n\nNo items. Use /todo <text> to add one.";
		} else {
			for (let i = 0; i < todos.length; i++) {
				text += `\n${theme.fg("dim", `${i + 1}.`)} ${todos[i]}`;
			}
		}
		ctx.chatContainer.addChild(new Spacer(1));
		ctx.chatContainer.addChild(new Text(text, 0, 0));
		ctx.requestRender();
		return;
	}
	const text = args.join(" ");
	const todos = [...ctx.getTodos(), text];
	ctx.setTodos(todos);
	ctx.showStatus(`Added todo: ${text}`);
	ctx.requestRender();
}

export async function handleInstantToolCommand(text: string, ctx: InstantToolContext): Promise<boolean> {
	if (!text.startsWith("/")) return false;
	const { command, args } = parseCommandArgs(text);
	switch (command) {
		case "read":
			await handleReadCommand(args, ctx);
			return true;
		case "grep":
			await handleGrepCommand(args, ctx);
			return true;
		case "edit":
			await handleEditCommand(args, ctx);
			return true;
		case "todo":
			handleTodoCommand(args, ctx);
			return true;
		default:
			return false;
	}
}
