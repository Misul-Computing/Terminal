/**
 * Laplace local inference engine provider.
 *
 * Spawns the Laplace CLI binary as a subprocess for each request.
 * Full tool support via Gemma4 chat format with token-based tool calling.
 * Incremental streaming: tokens are emitted as the engine generates them.
 *
 * Configuration via environment:
 * - MISUL_LAPLACE_MODEL: path to .gguf model file (required)
 * - MISUL_LAPLACE_BINARY: path to laplace binary (default: auto-detect)
 * - MISUL_LAPLACE_MAX_TOKENS: max generation tokens (default: 4096)
 * - MISUL_LAPLACE_EXTRA_ARGS: extra CLI args, space-separated
 */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readdirSync, writeFileSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { tmpdir } from "node:os";

import type {
	AssistantMessage,
	AssistantMessageEventStream,
	Context,
	Message,
	Model,
	SimpleStreamOptions,
	TextContent,
	ThinkingContent,
	Tool,
	ToolCall,
	ToolResultMessage,
	Usage,
} from "../types.ts";
import { createAssistantMessageEventStream } from "../utils/event-stream.ts";

export const LAPLACE_API = "laplace";
export const LAPLACE_PROVIDER = "laplace";
export const LAPLACE_MODEL_ID = "local";

const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_CONTEXT_WINDOW = 32768;

export function resolveLaplaceBinaryPath(): string {
	const env = process.env.MISUL_LAPLACE_BINARY;
	if (env && existsSync(env)) return env;

	const devPath = join(homedir(), "Projects", "Laplace", "build", "laplace");
	if (existsSync(devPath)) return devPath;

	return "laplace";
}

export function resolveLaplaceModelPath(): string | undefined {
	const env = process.env.MISUL_LAPLACE_MODEL;
	if (env && existsSync(env)) return env;

	const modelsDir = join(homedir(), "Projects", "Laplace", "models");
	if (existsSync(modelsDir)) {
		try {
			const files = readdirSync(modelsDir).filter((f) => f.endsWith(".gguf"));
			if (files.length > 0) return join(modelsDir, files[0]);
		} catch {}
	}

	return undefined;
}

// --- Gemma4 chat format rendering ---

function formatArgumentValue(value: unknown): string {
	if (value === null) return "null";
	if (typeof value === "boolean") return value ? "true" : "false";
	if (typeof value === "string") return `<|"|>${value}<|"|>`;
	if (typeof value === "number") return String(value);
	if (Array.isArray(value)) {
		return `[${value.map(formatArgumentValue).join(",")}]`;
	}
	if (typeof value === "object" && value !== undefined) {
		const entries = Object.entries(value as Record<string, unknown>);
		return `{${entries.map(([k, v]) => `${k}:${formatArgumentValue(v)}`).join(",")}}`;
	}
	return String(value);
}

function formatToolParameters(params: {
	properties?: Record<string, unknown>;
	required?: string[];
}): string {
	let result = "";
	if (params.properties) {
		const props = Object.entries(params.properties);
		result += `properties:{${props.map(([key, value]) => {
			const v = value as Record<string, unknown>;
			let s = `${key}:{`;
			let addComma = false;
			if (v.description) {
				s += `description:<|"|>${v.description}<|"|>`;
				addComma = true;
			}
			if (v.type) {
				if (addComma) s += ",";
				s += `type:<|"|>${String(v.type).toUpperCase()}<|"|>`;
			}
			s += "}";
			return s;
		}).join(",")}}`;
	}
	if (params.required && params.required.length > 0) {
		if (result) result += ",";
		result += `required:[${params.required.map((r) => `<|"|>${r}<|"|>`).join(",")}]`;
	}
	return result;
}

function formatToolDefinition(tool: Tool): string {
	let result = `declaration:${tool.name}{description:<|"|>${tool.description ?? ""}<|"|>`;
	if (tool.parameters) {
		const params = formatToolParameters(tool.parameters as unknown as { properties?: Record<string, unknown>; required?: string[] });
		if (params) result += `,parameters:{${params}}`;
	}
	result += "}";
	return result;
}

function toolCallToText(toolCall: ToolCall): string {
	const args = toolCall.arguments as Record<string, unknown>;
	const argStr = Object.entries(args).map(([k, v]) => `${k}:${formatArgumentValue(v)}`).join(",");
	return `<|tool_call>call:${toolCall.name}{${argStr}}<tool_call|>`;
}

function toolResultToText(message: ToolResultMessage): string {
	return message.content
		.map((block) => {
			if (block.type === "text") {
				return `<|tool_response>response:${message.toolName}{value:${formatArgumentValue(block.text)}}<tool_response|>`;
			}
			return "";
		})
		.filter(Boolean)
		.join("\n");
}

function messageContentToText(message: Message): string {
	if (message.role === "user") {
		if (typeof message.content === "string") return message.content;
		return message.content.map((b) => (b.type === "text" ? b.text : "")).join("\n");
	}
	if (message.role === "assistant") {
		return message.content
			.map((block) => {
				if (block.type === "text") return block.text;
				if (block.type === "thinking") return "";
				if (block.type === "toolCall") return toolCallToText(block);
				return "";
			})
			.filter(Boolean)
			.join("\n");
	}
	if (message.role === "toolResult") {
		return toolResultToText(message);
	}
	return "";
}

function renderChatPrompt(context: Context): string {
	const parts: string[] = [];

	const systemContent = context.systemPrompt ?? "";
	const tools = context.tools ?? [];
	if (systemContent || tools.length > 0) {
		parts.push("<|turn>system\n");
		if (systemContent) parts.push(systemContent.trim());
		for (const tool of tools) {
			parts.push(`<|tool>${formatToolDefinition(tool)}<tool|>`);
		}
		parts.push("<turn|>\n");
	}

	for (const message of context.messages) {
		const role = message.role === "assistant" ? "model" : message.role;
		const content = messageContentToText(message);
		parts.push(`<|turn>${role}\n${content}<turn|>\n`);
	}

	// Note: encode_chat adds BOS + <|turn>user\n...<turn|>\n<|turn>model\n
	// Our full chat format goes inside that user turn. The model sees the
	// special tokens and understands the conversation structure.
	return parts.join("");
}

// --- Output parsing ---

function parseToolArgs(argsStr: string): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	let i = 0;
	while (i < argsStr.length) {
		while (i < argsStr.length && (argsStr[i] === "," || argsStr[i] === " ")) i++;
		if (i >= argsStr.length) break;

		const keyStart = i;
		while (i < argsStr.length && argsStr[i] !== ":") i++;
		const key = argsStr.slice(keyStart, i).trim();
		if (i >= argsStr.length || !key) break;
		i++;

		const { value, end } = parseValue(argsStr, i);
		result[key] = value;
		i = end;
	}
	return result;
}

function parseValue(s: string, start: number): { value: unknown; end: number } {
	let i = start;
	while (i < s.length && s[i] === " ") i++;

	if (s[i] === "<" && s.slice(i, i + 5) === '<|"|>') {
		const endQuote = s.indexOf("<|\"|>", i + 5);
		if (endQuote !== -1) {
			return { value: s.slice(i + 5, endQuote), end: endQuote + 5 };
		}
	}
	if (s[i] === "{") {
		let depth = 1;
		let j = i + 1;
		while (j < s.length && depth > 0) {
			if (s[j] === "{") depth++;
			if (s[j] === "}") depth--;
			j++;
		}
		return { value: s.slice(i, j), end: j };
	}
	if (s[i] === "[") {
		let depth = 1;
		let j = i + 1;
		while (j < s.length && depth > 0) {
			if (s[j] === "[") depth++;
			if (s[j] === "]") depth--;
			j++;
		}
		return { value: s.slice(i, j), end: j };
	}

	const valStart = i;
	while (i < s.length && s[i] !== ",") i++;
	const raw = s.slice(valStart, i).trim();
	if (raw === "true") return { value: true, end: i };
	if (raw === "false") return { value: false, end: i };
	if (raw === "null") return { value: null, end: i };
	const num = Number(raw);
	if (!isNaN(num)) return { value: num, end: i };
	return { value: raw, end: i };
}

// --- Incremental stream parser ---
//
// The engine flushes stdout after each token. We consume chunks as they
// arrive and emit text_delta events incrementally. Special token sequences
// (<|tool_call>, <turn|>, thinking blocks) are detected across chunk
// boundaries by holding back text that could be the start of a marker.

const THINK_START = "<|channel>thought\n";
const THINK_END = "<channel|>";
const TOOL_CALL_START = "<|tool_call>";
const TOOL_CALL_END = "<tool_call|>";
const TURN_END = "<turn|>";

type StreamState = "thinking" | "text" | "tool_call";

type StreamCallbacks = {
	onThinking: (delta: string) => void;
	onText: (delta: string) => void;
	onToolCall: (name: string, args: Record<string, unknown>) => void;
	onDone: (fullText: string) => void;
	onError: (error: Error) => void;
};

function createIncrementalParser(callbacks: StreamCallbacks) {
	let state: StreamState = "thinking";
	let buffer = "";
	let fullText = "";
	let toolCallBuffer = "";

	function feed(chunk: string): void {
		buffer += chunk;

		while (buffer.length > 0) {
			if (state === "thinking") {
				// The model starts with <|channel>thought\n...<channel|>
				// Strip the THINK_START prefix if still present
				if (buffer.startsWith(THINK_START)) {
					buffer = buffer.slice(THINK_START.length);
				}
				const endIdx = buffer.indexOf(THINK_END);
				if (endIdx !== -1) {
					const thinkingContent = buffer.slice(0, endIdx);
					if (thinkingContent) callbacks.onThinking(thinkingContent);
					buffer = buffer.slice(endIdx + THINK_END.length);
					state = "text";
					continue;
				}
				// Stream thinking content incrementally, holding back potential partial THINK_END
				const partialLen = longestPartialMarker(buffer, [THINK_END]);
				const safeEnd = partialLen > 0 ? buffer.length - partialLen : buffer.length;
				if (safeEnd > 0) {
					callbacks.onThinking(buffer.slice(0, safeEnd));
					buffer = buffer.slice(safeEnd);
				}
				break;
			}

			if (state === "text") {
				// Look for special tokens in the buffer
				const toolCallIdx = buffer.indexOf(TOOL_CALL_START);
				const turnEndIdx = buffer.indexOf(TURN_END);

				// Find the earliest special token
				let earliest = -1;
				let earliestType: "tool_call" | "turn_end" | null = null;
				if (toolCallIdx !== -1 && (earliest === -1 || toolCallIdx < earliest)) {
					earliest = toolCallIdx;
					earliestType = "tool_call";
				}
				if (turnEndIdx !== -1 && (earliest === -1 || turnEndIdx < earliest)) {
					earliest = turnEndIdx;
					earliestType = "turn_end";
				}

				if (earliest !== -1) {
					// Emit text before the special token
					const textBefore = buffer.slice(0, earliest);
					if (textBefore) {
						fullText += textBefore;
						callbacks.onText(textBefore);
					}

					if (earliestType === "turn_end") {
						// End of turn, discard rest
						buffer = "";
						break;
					}

					if (earliestType === "tool_call") {
						// Move to tool_call state
						buffer = buffer.slice(earliest + TOOL_CALL_START.length);
						state = "tool_call";
						toolCallBuffer = "";
						continue;
					}
				}

				// No complete special token found.
				// Check if the buffer ends with a partial special token.
				const partialLen = longestPartialMarker(buffer);
				const safeEnd = partialLen > 0 ? buffer.length - partialLen : buffer.length;

				if (safeEnd > 0) {
					const safe = buffer.slice(0, safeEnd);
					buffer = buffer.slice(safeEnd);
					fullText += safe;
					callbacks.onText(safe);
				}
				break;
			}

			if (state === "tool_call") {
				const endIdx = buffer.indexOf(TOOL_CALL_END);
				if (endIdx !== -1) {
					toolCallBuffer += buffer.slice(0, endIdx);
					buffer = buffer.slice(endIdx + TOOL_CALL_END.length);
					state = "text";

					// Parse the tool call
					const callMatch = toolCallBuffer.match(/^call:(\S+?)\{([\s\S]*)\}$/);
					if (callMatch) {
						const [, name, argsStr] = callMatch;
						let args: Record<string, unknown> = {};
						try {
							args = parseToolArgs(argsStr);
						} catch {
							args = { _raw: argsStr };
						}
						callbacks.onToolCall(name, args);
					}
					toolCallBuffer = "";
					continue;
				}
				// Keep buffering
				toolCallBuffer += buffer;
				buffer = "";
				break;
			}

			break;
		}
	}

	function finish(): void {
		// Flush any remaining buffer
		if (buffer.length > 0) {
			if (state === "thinking") {
				// Model ended during thinking (no <channel|> emitted)
				callbacks.onThinking(buffer);
			} else if (state === "text") {
				fullText += buffer;
				callbacks.onText(buffer);
			}
			buffer = "";
		}
		callbacks.onDone(fullText);
	}

	return { feed, finish };
}

// Check if the end of the buffer could be the start of a special token.
// Returns the length of the partial match, or 0 if none.
function longestPartialMarker(buf: string, markers: string[] = [TOOL_CALL_START, TURN_END]): number {
	let longest = 0;
	for (const marker of markers) {
		for (let len = Math.min(marker.length - 1, buf.length); len > 0; len--) {
			if (buf.endsWith(marker.slice(0, len))) {
				if (len > longest) longest = len;
				break;
			}
		}
	}
	return longest;
}

// --- Laplace subprocess with incremental output ---

function spawnLaplace(
	binary: string,
	modelPath: string,
	prompt: string,
	maxTokens: number,
	maxSeq: number,
	extraArgs: string[],
	signal: AbortSignal | undefined,
	parser: ReturnType<typeof createIncrementalParser>,
): Promise<void> {
	return new Promise((resolve, reject) => {
		const promptFile = join(tmpdir(), `laplace-prompt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`);
		try {
			writeFileSync(promptFile, prompt, "utf-8");
		} catch (err) {
			reject(new Error(`Failed to write prompt file: ${err instanceof Error ? err.message : String(err)}`));
			return;
		}

		const args = [
			modelPath,
			"--prompt-file", promptFile,
			"-n", String(maxTokens),
			"--max-seq", String(maxSeq),
			...extraArgs,
		];
		let child: ChildProcess;
		try {
			child = spawn(binary, args, {
				stdio: ["pipe", "pipe", "pipe"],
				signal,
			});
		} catch (err) {
			unlinkSync(promptFile);
			reject(new Error(`Failed to start laplace: ${err instanceof Error ? err.message : String(err)}`));
			return;
		}

		let stderr = "";

		child.stdout?.on("data", (chunk: Buffer) => {
			parser.feed(chunk.toString());
		});
		child.stderr?.on("data", (chunk: Buffer) => {
			stderr += chunk.toString();
		});

		child.on("error", (err) => {
			unlinkSync(promptFile);
			reject(new Error(`Failed to start laplace: ${err.message}`));
		});
		child.on("close", (code) => {
			unlinkSync(promptFile);
			if (code !== 0) {
				const tail = stderr.trim().split("\n").slice(-3).join(" ");
				reject(new Error(`laplace exited with code ${code}: ${tail}`));
				return;
			}
			parser.finish();
			resolve();
		});
	});
}

const DEFAULT_USAGE: Usage = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

export interface LaplaceStreamOptions {
	binaryPath: string;
	modelPath: string;
	maxTokens?: number;
	maxSeq?: number;
	extraArgs?: string[];
}

export function createLaplaceStreamSimple(options: LaplaceStreamOptions) {
	const { binaryPath, modelPath, maxTokens = DEFAULT_MAX_TOKENS, maxSeq = DEFAULT_CONTEXT_WINDOW, extraArgs = [] } = options;

	return (_model: Model<string>, context: Context, streamOptions?: SimpleStreamOptions): AssistantMessageEventStream => {
		const eventStream = createAssistantMessageEventStream();
		const signal = streamOptions?.signal;

		const output: AssistantMessage = {
			role: "assistant",
			content: [],
			api: LAPLACE_API,
			provider: LAPLACE_PROVIDER,
			model: LAPLACE_MODEL_ID,
			usage: { ...DEFAULT_USAGE },
			stopReason: "stop",
			timestamp: Date.now(),
		};

		(async () => {
			try {
				eventStream.push({ type: "start", partial: { ...output } });

				const prompt = renderChatPrompt(context);
				let contentIndex = 0;
				let hasToolCall = false;
				let currentText = "";
				let textBlockOpen = false;
				let currentThinking = "";
				let thinkingBlockOpen = false;

				const closeThinking = () => {
					if (thinkingBlockOpen) {
						eventStream.push({ type: "thinking_end", contentIndex, content: currentThinking, partial: { ...output } });
						contentIndex++;
						thinkingBlockOpen = false;
						currentThinking = "";
					}
				};
				const closeText = () => {
					if (textBlockOpen) {
						eventStream.push({ type: "text_end", contentIndex, content: currentText, partial: { ...output } });
						contentIndex++;
						textBlockOpen = false;
						currentText = "";
					}
				};

				const parser = createIncrementalParser({
					onThinking: (delta) => {
						if (!thinkingBlockOpen) {
							output.content.push({ type: "thinking", thinking: "" });
							thinkingBlockOpen = true;
							eventStream.push({ type: "thinking_start", contentIndex, partial: { ...output } });
						}
						currentThinking += delta;
						(output.content[contentIndex] as ThinkingContent).thinking = currentThinking;
						eventStream.push({ type: "thinking_delta", contentIndex, delta, partial: { ...output } });
					},
					onText: (delta) => {
						closeThinking();
						if (!textBlockOpen) {
							output.content.push({ type: "text", text: "" });
							textBlockOpen = true;
							eventStream.push({ type: "text_start", contentIndex, partial: { ...output } });
						}
						currentText += delta;
						(output.content[contentIndex] as TextContent).text = currentText;
						eventStream.push({ type: "text_delta", contentIndex, delta, partial: { ...output } });
					},
					onToolCall: (name, args) => {
						closeThinking();
						closeText();
						const toolCall: ToolCall = {
							type: "toolCall",
							id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
							name,
							arguments: args,
						};
						output.content.push(toolCall);
						eventStream.push({ type: "toolcall_start", contentIndex, partial: { ...output } });
						eventStream.push({ type: "toolcall_delta", contentIndex, delta: JSON.stringify(args), partial: { ...output } });
						eventStream.push({ type: "toolcall_end", contentIndex, toolCall, partial: { ...output } });
						contentIndex++;
						hasToolCall = true;
					},
					onDone: (fullText) => {
						closeThinking();
						closeText();
						output.usage.output = Math.ceil(fullText.length / 4);
						output.usage.totalTokens = output.usage.output;
						output.stopReason = hasToolCall ? "toolUse" : "stop";
					},
					onError: (error) => {
						throw error;
					},
				});

				await spawnLaplace(binaryPath, modelPath, prompt, maxTokens, maxSeq, extraArgs, signal, parser);

				eventStream.push({
					type: "done",
					reason: output.stopReason as "stop" | "length" | "toolUse",
					message: { ...output },
				});
				eventStream.end(output);
			} catch (error) {
				output.stopReason = signal?.aborted ? "aborted" : "error";
				output.errorMessage = error instanceof Error ? error.message : String(error);
				eventStream.push({ type: "error", reason: output.stopReason, error: { ...output } });
				eventStream.end(output);
			}
		})();

		return eventStream;
	};
}

export const LAPLACE_DEFAULT_CONTEXT_WINDOW = DEFAULT_CONTEXT_WINDOW;
export const LAPLACE_DEFAULT_MAX_TOKENS = DEFAULT_MAX_TOKENS;
