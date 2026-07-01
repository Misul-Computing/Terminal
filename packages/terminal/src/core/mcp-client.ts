/**
 * MCP (Model Context Protocol) client.
 *
 * Spawns MCP server processes (stdio transport), discovers their tools
 * via the standard MCP protocol (initialize + tools/list), and exposes
 * them as agent tools.
 *
 * The MCP protocol is JSON-RPC 2.0 over stdio. Each server receives
 * requests on stdin and sends responses on stdout.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { join } from "node:path";
import { Type, type Static } from "typebox";
import type { AgentToolResult } from "@misul/agent-core";
import type { McpServerConfig } from "./addons.ts";
import { defineTool, type ToolDefinition } from "./extensions/types.ts";

/** A tool discovered from an MCP server. */
export interface McpTool {
	/** Tool name as reported by the MCP server. */
	name: string;
	/** Human-readable description. */
	description?: string;
	/** JSON schema for the tool's input parameters. */
	inputSchema?: Record<string, unknown>;
}

/** A running MCP server instance. */
export class McpServerInstance extends EventEmitter {
	private process: ChildProcess | null = null;
	private requestId = 0;
	private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
	private buffer = "";
	private tools: McpTool[] = [];
	private serverName: string;
	private config: McpServerConfig;
	private cwd: string;
	private initialized = false;

	constructor(serverName: string, config: McpServerConfig, cwd: string) {
		super();
		this.serverName = serverName;
		this.config = config;
		this.cwd = cwd;
	}

	/** Spawn the server process and perform the MCP handshake. */
	async start(): Promise<void> {
		if (this.process) return;

		const type = this.config.type ?? "stdio";
		if (type !== "stdio") {
			throw new Error(`MCP transport "${type}" not yet supported (use stdio)`);
		}

		if (!this.config.command) {
			throw new Error(`MCP server "${this.serverName}" has no command`);
		}

		this.process = spawn(this.config.command, this.config.args ?? [], {
			stdio: ["pipe", "pipe", "pipe"],
			cwd: this.config.cwd ?? this.cwd,
			env: { ...process.env, ...this.config.env },
		});

		this.process.stdout?.setEncoding("utf-8");
		this.process.stdout?.on("data", (data: string) => {
			this.buffer += data;
			this.processBuffer();
		});

		this.process.on("error", (err) => {
			this.emit("error", err);
		});

		this.process.on("exit", (code) => {
			this.emit("exit", code);
			this.process = null;
			// Reject all pending requests
			for (const [, { reject }] of this.pending) {
				reject(new Error(`MCP server "${this.serverName}" exited with code ${code}`));
			}
			this.pending.clear();
		});

		// Perform MCP handshake
		const result = await this.request("initialize", {
			protocolVersion: "2024-11-05",
			capabilities: {},
			clientInfo: { name: "misul-terminal", version: "0.2.0" },
		}) as { capabilities?: { tools?: {} } };

		// Send initialized notification
		this.notify("notifications/initialized", {});

		// Discover tools
		if (result.capabilities?.tools) {
			const toolsResult = await this.request("tools/list", {}) as { tools?: McpTool[] };
			this.tools = toolsResult.tools ?? [];
		}

		this.initialized = true;
	}

	/** Call a tool on the MCP server. */
	async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
		if (!this.initialized) {
			throw new Error(`MCP server "${this.serverName}" not initialized`);
		}
		return this.request("tools/call", { name, arguments: args });
	}

	/** Get the list of tools discovered from this server. */
	getTools(): McpTool[] {
		return this.tools;
	}

	/** Whether the server is running and initialized. */
	isRunning(): boolean {
		return this.initialized && this.process !== null;
	}

	/** Stop the server process. */
	stop(): void {
		if (this.process) {
			this.process.kill();
			this.process = null;
		}
		this.initialized = false;
		for (const [, { reject }] of this.pending) {
			reject(new Error(`MCP server "${this.serverName}" stopped`));
		}
		this.pending.clear();
	}

	/** Send a JSON-RPC request and wait for the response. */
	private request(method: string, params: unknown): Promise<unknown> {
		return new Promise((resolve, reject) => {
			if (!this.process?.stdin?.writable) {
				reject(new Error(`MCP server "${this.serverName}" stdin not writable`));
				return;
			}
			const id = ++this.requestId;
			this.pending.set(id, { resolve, reject });
			const message = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
			this.process.stdin.write(message);
			// Timeout after 30s
			setTimeout(() => {
				if (this.pending.has(id)) {
					this.pending.delete(id);
					reject(new Error(`MCP request "${method}" to "${this.serverName}" timed out`));
				}
			}, 30000);
		});
	}

	/** Send a JSON-RPC notification (no response expected). */
	private notify(method: string, params: unknown): void {
		if (!this.process?.stdin?.writable) return;
		const message = JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n";
		this.process.stdin.write(message);
	}

	/** Process buffered stdout data, extracting complete JSON-RPC messages. */
	private processBuffer(): void {
		while (true) {
			const newlineIdx = this.buffer.indexOf("\n");
			if (newlineIdx === -1) break;
			const line = this.buffer.slice(0, newlineIdx).trim();
			this.buffer = this.buffer.slice(newlineIdx + 1);
			if (!line) continue;
			try {
				const msg = JSON.parse(line);
				if (msg.id !== undefined && this.pending.has(msg.id)) {
					const handler = this.pending.get(msg.id)!;
					this.pending.delete(msg.id);
					if (msg.error) {
						handler.reject(new Error(msg.error.message ?? "MCP error"));
					} else {
						handler.resolve(msg.result);
					}
				}
			} catch {
				// Not a valid JSON-RPC message, skip
			}
		}
	}
}

/** Manages multiple MCP server instances. */
export class McpManager {
	private servers = new Map<string, McpServerInstance>();
	private cwd: string;

	constructor(cwd: string) {
		this.cwd = cwd;
	}

	/** Start an MCP server from a config entry. */
	async startServer(name: string, config: McpServerConfig): Promise<McpServerInstance> {
		if (this.servers.has(name)) {
			return this.servers.get(name)!;
		}
		const instance = new McpServerInstance(name, config, this.cwd);
		await instance.start();
		this.servers.set(name, instance);
		return instance;
	}

	/** Start multiple MCP servers from a config map. */
	async startServers(configs: Record<string, McpServerConfig>): Promise<void> {
		const entries = Object.entries(configs);
		await Promise.all(
			entries.map(async ([name, config]) => {
				try {
					await this.startServer(name, config);
				} catch (err) {
					console.error(`Failed to start MCP server "${name}": ${err instanceof Error ? err.message : String(err)}`);
				}
			}),
		);
	}

	/** Get all tools from all running MCP servers, as agent tool definitions. */
	getToolDefinitions(): ToolDefinition[] {
		const tools: ToolDefinition[] = [];
		const sortedServers = [...this.servers.entries()].sort(([a], [b]) => a.localeCompare(b));
		for (const [serverName, instance] of sortedServers) {
			if (!instance.isRunning()) continue;
			const sortedMcpTools = [...instance.getTools()].sort((a, b) => a.name.localeCompare(b.name));
			for (const mcpTool of sortedMcpTools) {
				const toolName = `mcp__${serverName}__${mcpTool.name}`;
				const rawDesc = mcpTool.description ?? `MCP tool: ${mcpTool.name} from ${serverName}`;
				const cleanDesc = sanitizeMcpDescription(rawDesc);
				// MCP tools have arbitrary JSON schemas. Use a permissive TypeBox schema
				// that accepts any object so the agent can pass through whatever the server expects.
				// Property keys are sorted for deterministic serialization (cache stability).
				// Descriptions are sanitized to strip runtime paths/ports/tokens.
				const schema = Type.Object(
					Object.fromEntries(
						Object.entries(mcpTool.inputSchema?.properties ?? {})
							.sort(([a], [b]) => a.localeCompare(b))
							.map(([key, val]) => {
								const v = val as { type?: string; description?: string };
								return [key, Type.Any({ description: sanitizeMcpDescription(v?.description ?? "") })];
							}),
					),
					{ description: cleanDesc },
				);
				const capName = mcpTool.name.charAt(0).toUpperCase() + mcpTool.name.slice(1);
				tools.push(
					defineTool({
						name: toolName,
						label: `${serverName}: ${capName}`,
						description: cleanDesc,
						parameters: schema,
						execute: async (_id, params): Promise<AgentToolResult<undefined>> => {
							const result = await instance.callTool(mcpTool.name, params as Record<string, unknown>);
							return { content: [{ type: "text", text: formatMcpResult(result) }], details: undefined };
						},
					}),
				);
			}
		}
		return tools;
	}

	/** Stop all MCP servers. */
	stopAll(): void {
		for (const instance of this.servers.values()) {
			instance.stop();
		}
		this.servers.clear();
	}

	/** Get running server names. */
	getServerNames(): string[] {
		return Array.from(this.servers.keys()).filter((name) => this.servers.get(name)?.isRunning());
	}
}

/**
 * Strip non-deterministic content from MCP tool descriptions so the tool
 * schema block stays byte-identical across restarts/reconnects.
 *
 * Removes: absolute paths, port numbers in URLs, query-string tokens/keys.
 * See docs/cache-aware-design.md: "strip runtime paths/ports/tokens from
 * descriptions."
 */
export function sanitizeMcpDescription(desc: string): string {
	return desc
		// Strip absolute POSIX paths (/tmp/..., /home/..., /var/...).
		.replace(/(?:^|\s)((?:\/[\w.-]+)+)/g, " <path>")
		// Strip absolute Windows paths (C:\Users\...).
		.replace(/[A-Za-z]:\\[\w\\.-]+/g, "<path>")
		// Strip port numbers in URLs (http://host:8080 -> http://host).
		.replace(/(https?:\/\/[^\s/:]+):\d+/g, "$1")
		// Strip query-string tokens and API keys.
		.replace(/[?&](?:token|key|api_key|apikey|secret)=[^\s&]+/gi, "");
}

/** Format an MCP tool call result into a string for the agent. */
function formatMcpResult(result: unknown): string {
	if (typeof result === "string") return result;
	if (result && typeof result === "object") {
		const r = result as { content?: Array<{ type: string; text?: string }> };
		if (Array.isArray(r.content)) {
			return r.content
				.filter((c) => c.type === "text" && c.text)
				.map((c) => c.text!)
				.join("\n");
		}
	}
	return JSON.stringify(result, null, 2);
}
