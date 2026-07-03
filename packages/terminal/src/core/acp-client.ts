import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { Type } from "typebox";
import type { AgentToolResult } from "@misul/agent-core";
import type { AcpAgentConfig } from "./addons.ts";
import { defineTool, type ToolDefinition } from "./extensions/types.ts";

const ACP_PROTOCOL_VERSION = 1;

export class AcpAgentInstance extends EventEmitter {
	private process: ChildProcess | null = null;
	private requestId = 0;
	private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
	private buffer = "";
	private agentName: string;
	private config: AcpAgentConfig;
	private cwd: string;
	private initialized = false;
	private sessionId: string | null = null;
	private agentInfo: { name: string; version: string } | null = null;
	private lastPromptText = "";

	constructor(agentName: string, config: AcpAgentConfig, cwd: string) {
		super();
		this.agentName = agentName;
		this.config = config;
		this.cwd = cwd;
	}

	async start(): Promise<void> {
		if (this.process) return;
		if ((this.config.type ?? "stdio") !== "stdio") throw new Error(`ACP transport "${this.config.type}" not yet supported (use stdio)`);
		if (!this.config.command) throw new Error(`ACP agent "${this.agentName}" has no command`);

		this.process = spawn(this.config.command, this.config.args ?? [], {
			stdio: ["pipe", "pipe", "pipe"],
			cwd: this.config.cwd ?? this.cwd,
			env: { ...process.env, ...this.config.env },
		});

		this.process.stdout?.setEncoding("utf-8");
		this.process.stdout?.on("data", (data: string) => { this.buffer += data; this.processBuffer(); });
		this.process.on("error", (err) => this.emit("error", err));
		this.process.on("exit", (code) => {
			this.emit("exit", code);
			this.process = null;
			for (const [, { reject }] of this.pending) reject(new Error(`ACP agent "${this.agentName}" exited with code ${code}`));
			this.pending.clear();
		});

		const initResult = await this.request("initialize", {
			protocolVersion: ACP_PROTOCOL_VERSION,
			clientInfo: { name: "misul-terminal", version: "0.2.0" },
			clientCapabilities: {},
		}) as { agentInfo?: { name: string; version: string } };

		this.agentInfo = initResult.agentInfo ?? { name: this.agentName, version: "unknown" };

		const sessionResult = await this.request("session/new", { mcpServers: [], cwd: this.config.cwd ?? this.cwd }) as { sessionId: string };
		this.sessionId = sessionResult.sessionId;
		this.initialized = true;
	}

	async prompt(text: string): Promise<string> {
		if (!this.initialized || !this.sessionId) throw new Error(`ACP agent "${this.agentName}" not initialized`);
		await this.request("session/prompt", { sessionId: this.sessionId, prompt: [{ type: "text", text }] });
		return this.lastPromptText || "(agent produced no text output)";
	}

	cancel(): void { if (this.sessionId) this.notify("session/cancel", { sessionId: this.sessionId }); }
	getAgentInfo(): { name: string; version: string } | null { return this.agentInfo; }
	isRunning(): boolean { return this.initialized && this.process !== null; }

	stop(): void {
		if (this.process) { this.process.kill(); this.process = null; }
		this.initialized = false;
		this.sessionId = null;
		for (const [, { reject }] of this.pending) reject(new Error(`ACP agent "${this.agentName}" stopped`));
		this.pending.clear();
	}

	private request(method: string, params: unknown): Promise<unknown> {
		return new Promise((resolve, reject) => {
			if (!this.process?.stdin?.writable) { reject(new Error(`ACP agent "${this.agentName}" stdin not writable`)); return; }
			const id = ++this.requestId;
			this.pending.set(id, { resolve, reject });
			if (method === "session/prompt") this.lastPromptText = "";
			this.process.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
			setTimeout(() => {
				if (this.pending.has(id)) { this.pending.delete(id); reject(new Error(`ACP request "${method}" to "${this.agentName}" timed out`)); }
			}, 120000);
		});
	}

	private notify(method: string, params: unknown): void {
		if (this.process?.stdin?.writable) this.process.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
	}

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
					if (msg.error) handler.reject(new Error(msg.error.message ?? "ACP error"));
					else handler.resolve(msg.result);
				}
				if (msg.method === "session/update" && msg.params) {
					const u = (msg.params as { update?: { type?: string; text?: string } }).update;
					if (u?.type === "agent" && u.text) this.lastPromptText += u.text;
				}
			} catch { }
		}
	}
}

export class AcpManager {
	private agents = new Map<string, AcpAgentInstance>();
	private cwd: string;
	constructor(cwd: string) { this.cwd = cwd; }

	async startAgents(configs: Record<string, AcpAgentConfig>): Promise<void> {
		await Promise.all(Object.entries(configs).map(async ([name, config]) => {
			if (this.agents.has(name)) return;
			try {
				const instance = new AcpAgentInstance(name, config, this.cwd);
				await instance.start();
				this.agents.set(name, instance);
			} catch (err) {
				console.error(`Failed to start ACP agent "${name}": ${err instanceof Error ? err.message : String(err)}`);
			}
		}));
	}

	getToolDefinitions(): ToolDefinition[] {
		return [...this.agents.entries()].sort(([a], [b]) => a.localeCompare(b))
			.filter(([, inst]) => inst.isRunning())
			.map(([agentName, instance]) => {
				const info = instance.getAgentInfo();
				return defineTool({
					name: `acp__${agentName}__prompt`,
					label: `ACP: ${agentName}`,
					description: `ACP agent: ${info?.name ?? agentName} v${info?.version ?? "unknown"}. Send a prompt to this external coding agent and receive its response.`,
					parameters: Type.Object({ prompt: Type.String({ description: "The prompt to send to the agent" }) }),
					execute: async (_id, params): Promise<AgentToolResult<undefined>> => ({
						content: [{ type: "text", text: await instance.prompt(params.prompt as string) }],
						details: undefined,
					}),
				});
			});
	}

	stopAll(): void { for (const inst of this.agents.values()) inst.stop(); this.agents.clear(); }
	getAgentNames(): string[] { return [...this.agents.keys()].filter((n) => this.agents.get(n)?.isRunning()); }
}
