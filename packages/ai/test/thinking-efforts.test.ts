import { describe, expect, it } from "vitest";
import { type ThinkingModelInput, thinkingLevelMapFor } from "../scripts/thinking-efforts.ts";

// Levels a map marks supported (non-null), in canonical order.
const ORDER = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
function supported(model: ThinkingModelInput): string[] {
	const map = thinkingLevelMapFor(model) ?? {};
	return ORDER.filter((l) => map[l] !== undefined && map[l] !== null);
}
function m(id: string, provider: string, api: string, releaseDate = "2026-01-01"): ThinkingModelInput {
	return { id, provider, api, releaseDate, reasoning: true };
}

describe("thinking-efforts port (OpenCode parity)", () => {
	it("OpenAI gpt-5 (original): minimal/low/medium/high", () => {
		expect(supported(m("gpt-5", "openai", "openai-responses", "2025-08-07"))).toEqual([
			"minimal",
			"low",
			"medium",
			"high",
		]);
	});

	it("OpenAI gpt-5.5-pro: medium/high/xhigh (settles the dispute)", () => {
		expect(supported(m("gpt-5.5-pro", "openai", "openai-responses"))).toEqual(["medium", "high", "xhigh"]);
	});

	it("OpenAI gpt-5.2: off(none)/low/medium/high/xhigh", () => {
		expect(supported(m("gpt-5.2", "openai", "openai-responses"))).toEqual(["off", "low", "medium", "high", "xhigh"]);
	});

	it("Anthropic Opus 4.8: low/medium/high/xhigh/max, NO off (always-on adaptive, can't disable)", () => {
		expect(supported(m("claude-opus-4-8", "anthropic", "anthropic-messages"))).toEqual([
			"low",
			"medium",
			"high",
			"xhigh",
			"max",
		]);
	});

	it("Anthropic Opus 4.6: off + low/medium/high/max (no xhigh)", () => {
		expect(supported(m("claude-opus-4-6", "anthropic", "anthropic-messages"))).toEqual([
			"off",
			"low",
			"medium",
			"high",
			"max",
		]);
	});

	it("Anthropic Sonnet 4.5 (older): off + high/max budget tiers", () => {
		expect(supported(m("claude-sonnet-4-5", "anthropic", "anthropic-messages"))).toEqual(["off", "high", "max"]);
	});

	it("Anthropic dated alias is not misparsed as a newer version (opus-4-20250514 == opus-4-0)", () => {
		// The 8-digit date must not be read as minor version 20250514 (>=7), which would
		// over-offer the Opus 4.7+ adaptive tier set. The dated id must match its base alias.
		const dated = supported(m("claude-opus-4-20250514", "anthropic", "anthropic-messages"));
		const base = supported(m("claude-opus-4-0", "anthropic", "anthropic-messages"));
		expect(dated).toEqual(base);
		expect(dated).toEqual(["off", "high", "max"]);
	});

	it("Gemini 3.1 Pro: low/medium/high (now includes the medium tier)", () => {
		expect(supported(m("gemini-3.1-pro-preview", "google", "google-generative-ai"))).toEqual([
			"low",
			"medium",
			"high",
		]);
	});

	it("Gemini 3 Flash: minimal/low/medium/high", () => {
		expect(supported(m("gemini-3-flash-preview", "google", "google-generative-ai"))).toEqual([
			"minimal",
			"low",
			"medium",
			"high",
		]);
	});

	it("DeepSeek V4 Flash: off + high/max only (reasoning_effort accepts exactly high|max)", () => {
		expect(supported(m("deepseek-v4-flash", "opencode-go", "openai-completions"))).toEqual([
			"off",
			"high",
			"max",
		]);
	});

	it("Kimi K2.5 (no graded tiers): off/high binary", () => {
		expect(supported(m("kimi-k2.5", "moonshotai", "openai-completions"))).toEqual(["off", "high"]);
	});

	it("Claude via GitHub Copilot: low/medium/high only (host-specific, no max)", () => {
		expect(supported(m("claude-opus-4.8", "github-copilot", "openai-responses"))).toEqual(["low", "medium", "high"]);
	});
});
