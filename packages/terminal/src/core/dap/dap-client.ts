// Debug Adapter Protocol client. Speaks the DAP wire protocol
// (Content-Length header + JSON body) over stdin/stdout of a child
// process. Launches any DAP-compatible debug adapter (js-debug,
// debugpy, delve, lldb-mi, etc.) and exposes a small API for the
// agent to set breakpoints, inspect state, and step through code.

import { spawn, type ChildProcess } from "node:child_process";

interface DapRequest {
	seq: number;
	type: "request";
	command: string;
	arguments?: Record<string, unknown>;
}

interface DapResponse {
	seq: number;
	type: "response";
	request_seq: number;
	success: boolean;
	command: string;
	message?: string;
	body?: Record<string, unknown>;
}

interface DapEvent {
	seq: number;
	type: "event";
	event: string;
	body?: Record<string, unknown>;
}

export type DapMessage = DapResponse | DapEvent;

export interface Breakpoint {
	file: string;
	line: number;
	condition?: string;
}

export interface StackFrame {
	id: number;
	name: string;
	source: { path: string; name: string } | undefined;
	line: number;
	column: number;
}

export interface Scope {
	name: string;
	variablesReference: number;
	presentationHint?: string;
}

export interface Variable {
	name: string;
	value: string;
	type?: string;
	variablesReference: number;
}

type EventHandler = (body: Record<string, unknown>) => void;

export class DapClient {
	private _proc: ChildProcess | undefined;
	private _seq = 1;
	private _buffer = Buffer.alloc(0);
	private _contentLength = -1;
	private _pending = new Map<number, { resolve: (r: DapResponse) => void; reject: (e: Error) => void }>();
	private _eventHandlers = new Map<string, Set<EventHandler>>();
	private _stopped = false;
	private _terminated = false;
	private _command: string;
	private _args: string[];
	private _cwd?: string;

	constructor(command: string, args: string[] = [], cwd?: string) {
		this._command = command;
		this._args = args;
		this._cwd = cwd;
	}

	async start(): Promise<void> {
		this._proc = spawn(this._command, this._args, {
			stdio: ["pipe", "pipe", "pipe"],
			cwd: this._cwd,
		});

		this._proc.stdout?.on("data", (data: Buffer) => this._onData(data));
		this._proc.stderr?.on("data", () => { /* adapter diagnostics, ignore */ });

		this._proc.on("error", (err) => {
			this._terminated = true;
			for (const { reject } of this._pending.values()) {
				reject(err);
			}
			this._pending.clear();
		});

		this._proc.on("exit", () => {
			this._terminated = true;
			for (const { reject } of this._pending.values()) {
				reject(new Error("Debug adapter exited"));
			}
			this._pending.clear();
		});

		await this.send("initialize", {
			clientID: "misul",
			clientName: "Misul Terminal",
			adapterID: "misul",
			linesStartAt1: true,
			columnsStartAt1: true,
			pathFormat: "path",
			supportsRunInTerminalRequest: false,
		});
	}

	async launch(config: Record<string, unknown>): Promise<void> {
		await this.send("launch", config);
		await this.send("configurationDone", {});
	}

	async setBreakpoints(file: string, breakpoints: Breakpoint[]): Promise<void> {
		await this.send("setBreakpoints", {
			source: { path: file },
			breakpoints: breakpoints.map((bp) => ({
				line: bp.line,
				condition: bp.condition,
			})),
			sourceModified: false,
		});
	}

	async stackTrace(threadId: number, maxFrames = 50): Promise<StackFrame[]> {
		const res = await this.send("stackTrace", {
			threadId,
			startFrame: 0,
			levels: maxFrames,
		});
		const frames = (res.body?.stackFrames ?? []) as Record<string, unknown>[];
		return frames.map((f) => ({
			id: Number(f.id),
			name: String(f.name),
			source: f.source ? { path: String((f.source as Record<string, unknown>).path ?? ""), name: String((f.source as Record<string, unknown>).name ?? "") } : undefined,
			line: Number(f.line),
			column: Number(f.column),
		}));
	}

	async scopes(frameId: number): Promise<Scope[]> {
		const res = await this.send("scopes", { frameId });
		const scopes = (res.body?.scopes ?? []) as Record<string, unknown>[];
		return scopes.map((s) => ({
			name: String(s.name),
			variablesReference: Number(s.variablesReference ?? 0),
			presentationHint: s.presentationHint ? String(s.presentationHint) : undefined,
		}));
	}

	async variables(variablesReference: number): Promise<Variable[]> {
		const res = await this.send("variables", { variablesReference });
		const vars = (res.body?.variables ?? []) as Record<string, unknown>[];
		return vars.map((v) => ({
			name: String(v.name),
			value: String(v.value),
			type: v.type ? String(v.type) : undefined,
			variablesReference: Number(v.variablesReference ?? 0),
		}));
	}

	async continue(threadId: number): Promise<void> {
		// Reset _stopped before sending so a fast stopped event from the
		// same chunk doesn't get overwritten by this line after the await.
		this._stopped = false;
		await this.send("continue", { threadId });
	}

	async step(threadId: number, direction: "next" | "stepIn" | "stepOut"): Promise<void> {
		// Reset _stopped before sending, same reason as continue().
		this._stopped = false;
		await this.send(direction, { threadId });
	}

	async evaluate(expression: string, frameId: number): Promise<string> {
		const res = await this.send("evaluate", { expression, frameId, context: "repl" });
		return String(res.body?.result ?? "");
	}

	async threads(): Promise<{ id: number; name: string }[]> {
		const res = await this.send("threads", {});
		const threads = (res.body?.threads ?? []) as Record<string, unknown>[];
		return threads.map((t) => ({ id: Number(t.id), name: String(t.name) }));
	}

	onEvent(event: string, handler: EventHandler): () => void {
		let set = this._eventHandlers.get(event);
		if (!set) {
			set = new Set();
			this._eventHandlers.set(event, set);
		}
		set.add(handler);
		return () => set.delete(handler);
	}

	get isStopped(): boolean { return this._stopped; }
	get isTerminated(): boolean { return this._terminated; }

	waitForStop(timeoutMs = 30000): Promise<{ threadId: number; reason: string }> {
		return new Promise((resolve, reject) => {
			if (this._stopped) {
				resolve({ threadId: 0, reason: "already stopped" });
				return;
			}
			const timer = setTimeout(() => {
				unsub();
				reject(new Error("Timeout waiting for stop"));
			}, timeoutMs);
			const unsub = this.onEvent("stopped", (body) => {
				clearTimeout(timer);
				unsub();
				resolve({ threadId: Number(body.threadId ?? 0), reason: String(body.reason ?? "") });
			});
		});
	}

	private send(command: string, args?: Record<string, unknown>): Promise<DapResponse> {
		return new Promise((resolve, reject) => {
			if (!this._proc?.stdin?.writable) {
				reject(new Error("Debug adapter not running"));
				return;
			}
			const seq = this._seq++;
			const request: DapRequest = { seq, type: "request", command, arguments: args };
			this._pending.set(seq, { resolve, reject });
			const json = JSON.stringify(request);
			const msg = `Content-Length: ${Buffer.byteLength(json, "utf8")}\r\n\r\n${json}`;
			this._proc.stdin.write(msg, "utf8");
		});
	}

	private _onData(data: Buffer): void {
		this._buffer = Buffer.concat([this._buffer, data]);
		while (true) {
			if (this._contentLength < 0) {
				// Look for header terminator.
				const idx = this._buffer.indexOf("\r\n\r\n");
				if (idx === -1) return;
				const header = this._buffer.subarray(0, idx).toString("ascii");
				const match = header.match(/Content-Length:\s*(\d+)/i);
				if (!match) {
					// Not a valid header, skip past it.
					this._buffer = this._buffer.subarray(idx + 4);
					continue;
				}
				this._contentLength = parseInt(match[1], 10);
				this._buffer = this._buffer.subarray(idx + 4);
			}
			// Wait until we have the full body.
			if (this._buffer.length < this._contentLength) return;
			const body = this._buffer.subarray(0, this._contentLength);
			this._buffer = this._buffer.subarray(this._contentLength);
			this._contentLength = -1;
			try {
				const msg = JSON.parse(body.toString("utf8")) as DapMessage;
				this._dispatch(msg);
			} catch {
				// Malformed JSON, skip.
			}
		}
	}

	private _dispatch(msg: DapMessage): void {
		if (msg.type === "response") {
			const pending = this._pending.get(msg.request_seq);
			if (pending) {
				this._pending.delete(msg.request_seq);
				if (msg.success) pending.resolve(msg);
				else pending.reject(new Error(msg.message ?? `DAP request ${msg.command} failed`));
			}
		} else if (msg.type === "event") {
			if (msg.event === "stopped") this._stopped = true;
			if (msg.event === "terminated") this._terminated = true;
			const handlers = this._eventHandlers.get(msg.event);
			if (handlers) {
				for (const h of handlers) h(msg.body ?? {});
			}
		}
	}

	async disconnect(): Promise<void> {
		try {
			await this.send("disconnect", {});
		} catch {
			// Adapter may have already exited.
		}
		this._proc?.kill();
		this._proc = undefined;
	}
}
