import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AcpManager, AcpAgentInstance } from "../src/core/acp-client.ts";
import type { AcpAgentConfig } from "../src/core/addons.ts";

const TEST_AGENT_SCRIPT = `
const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });
function send(msg) { process.stdout.write(JSON.stringify(msg) + '\\n'); }
rl.on('line', (line) => {
	try {
		const msg = JSON.parse(line);
		if (msg.id === undefined) return;
		if (msg.method === 'initialize') {
			send({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: 1, agentInfo: { name: 'test-agent', version: '1.0.0' }, agentCapabilities: {} } });
		} else if (msg.method === 'session/new') {
			send({ jsonrpc: '2.0', id: msg.id, result: { sessionId: 'test-session-' + Date.now() } });
		} else if (msg.method === 'session/prompt') {
			send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: msg.params.sessionId, update: { type: 'agent', text: 'Echo: ' + msg.params.prompt[0].text } } });
			send({ jsonrpc: '2.0', id: msg.id, result: { session: { stopReason: 'stop' } } });
		} else {
			send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Method not found' } });
		}
	} catch {}
});
`;

describe("ACP client", () => {
	let tmpDir: string;
	let agentScriptPath: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "misul-acp-client-"));
		agentScriptPath = join(tmpDir, "test-agent.js");
		writeFileSync(agentScriptPath, TEST_AGENT_SCRIPT);
	});
	afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

	it("starts, initializes, and creates a session", async () => {
		const instance = new AcpAgentInstance("test-agent", { command: "node", args: [agentScriptPath] }, tmpDir);
		await instance.start();
		expect(instance.isRunning()).toBe(true);
		expect(instance.getAgentInfo()).toEqual({ name: "test-agent", version: "1.0.0" });
		instance.stop();
	});

	it("prompts and receives a response", async () => {
		const instance = new AcpAgentInstance("test-agent", { command: "node", args: [agentScriptPath] }, tmpDir);
		await instance.start();
		expect(await instance.prompt("Hello ACP!")).toContain("Echo: Hello ACP!");
		instance.stop();
	});

	it("throws if command is missing", async () => {
		const instance = new AcpAgentInstance("no-command", { command: undefined }, tmpDir);
		await expect(instance.start()).rejects.toThrow("no command");
	});

	it("throws for unsupported transport", async () => {
		const instance = new AcpAgentInstance("http-test", { type: "http" as any, command: "node" }, tmpDir);
		await expect(instance.start()).rejects.toThrow("not yet supported");
	});

	it("AcpManager manages multiple agents", async () => {
		const config: AcpAgentConfig = { command: "node", args: [agentScriptPath] };
		const manager = new AcpManager(tmpDir);
		await manager.startAgents({ "agent-1": config, "agent-2": config });
		const names = manager.getAgentNames();
		expect(names).toContain("agent-1");
		expect(names).toContain("agent-2");
		const tools = manager.getToolDefinitions();
		expect(tools.length).toBe(2);
		expect(tools[0].name).toMatch(/^acp__.*__prompt$/);
		manager.stopAll();
	});
});
