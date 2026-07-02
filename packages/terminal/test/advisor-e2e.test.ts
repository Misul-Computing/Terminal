import { describe, it, expect } from "vitest";
import { createAgentSession } from "../src/core/sdk.ts";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { registerFauxProvider, fauxAssistantMessage } from "@misul/ai";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * End-to-end test: the advisor fires after enough turns with sufficient hardness,
 * calls the model, and injects steering advice into the session.
 *
 * This is the test that caught the auth bug: the advisor was not passing
 * authStorage to runSubagent, so the advisor's subagent could not authenticate.
 */
describe("advisor e2e", () => {
	it("fires after 6+ turns with sufficient hardness and injects advice", async () => {
		const tempDir = join(tmpdir(), `misul-advisor-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });

		const faux = registerFauxProvider({ models: [{ id: "faux-1", reasoning: false }] });

		// Responses: 7 short answers for the main turns, then the advisor response.
		// The advisor fires after turn 6 (hardness >= 45, cooldown = 6).
		// We use long responses to generate token usage for hardness.
		// The main session consumes 6 responses (turns 1-6).
		// The advisor fires after turn 6 and its subagent consumes the next response.
		// So the advisor response must be at index 6 (the 7th response).
		const advisorResponse = "ADVISOR_VERIFIED: You should verify claims by running tests before declaring done.";
		const responses: ReturnType<typeof fauxAssistantMessage>[] = [];
		// 6 main turn responses
		for (let i = 0; i < 6; i++) {
			responses.push(
				fauxAssistantMessage(`Main response ${i}. ${"x".repeat(500)}`, { stopReason: "stop" }),
			);
		}
		// Advisor response at index 6 (must not start with "No advice")
		responses.push(
			fauxAssistantMessage(advisorResponse, { stopReason: "stop" }),
		);
		// Extra responses for any other calls
		for (let i = 0; i < 10; i++) {
			responses.push(
				fauxAssistantMessage(`Extra ${i}.`, { stopReason: "stop" }),
			);
		}
		faux.setResponses(responses);

		const authStorage = AuthStorage.inMemory();
		authStorage.setRuntimeApiKey(faux.getModel().provider, "faux-key");

		const { session } = await createAgentSession({
			cwd: tempDir,
			agentDir: tempDir,
			authStorage,
			model: faux.getModel(),
			permissionGateEnabled: false,
			thinkingLevel: "off",
		});

		let advisorAdvice: string | null = null;
		session.subscribe((event) => {
			if (event.type === "queue_update") {
				const steering = (event as { steering?: string[] }).steering;
				if (steering) {
					for (const msg of steering) {
						if (msg.includes("[advisor]")) {
							advisorAdvice = msg;
						}
					}
				}
			}
		});

		// Send 6 prompts to build up hardness (need 6+ turns, hardness >= 45).
		// The advisor fires after turn 6 completes, as a background async call.
		// We stop at 6 so the advisor's subagent gets the next response (the advisor response).
		for (let i = 0; i < 6; i++) {
			await session.prompt(
				`Turn ${i + 1}: Build a complex REST API with auth, validation, rate limiting, error handling, and tests. ${"x".repeat(200)}`,
			);
			await session.agent.waitForIdle();
		}

		// Wait for the async advisor to complete (it runs as a background promise).
		// The advisor has a 90s timeout but the faux provider responds instantly.
		// We need to wait for the advisor's subagent LLM call to finish and
		// the steering message to be queued.
		for (let attempt = 0; attempt < 30 && !advisorAdvice; attempt++) {
			await new Promise((r) => setTimeout(r, 1000));
		}

		session.dispose();
		faux.unregister();
		if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });

		expect(advisorAdvice).not.toBeNull();
		expect(advisorAdvice).toContain("[advisor]");
		expect(advisorAdvice).toContain("ADVISOR_VERIFIED");
	}, 60000);
});
