/**
 * Thinking-mode effort sets, ported from OpenCode's ProviderTransform.variants
 * (github.com/anomalyco/opencode, packages/opencode/src/provider/transform.ts).
 *
 * OpenCode is the source of truth for which reasoning-effort tiers each model
 * actually exposes, host-aware (Claude via Copilot differs from direct Claude).
 * We port their effort SETS and translate them into a Misul `thinkingLevelMap`:
 * each supported tier maps to its effort name, every other tier is `null`
 * (unsupported). OpenCode effort names map 1:1 to Misul ThinkingLevels, with
 * `none` -> `off` (reasoning can be disabled).
 *
 * Returns `undefined` when a model has graded effort tiers handled by the
 * generic path, `{}`-equivalent (binary: off+high only) for no-effort models,
 * or the explicit map otherwise.
 */

type LevelMap = Record<string, string | null>;

// Minimal view of a catalog model needed to compute efforts.
export interface ThinkingModelInput {
	id: string;
	provider: string;
	api: string;
	releaseDate?: string;
	reasoning?: boolean;
}

const WIDELY = ["low", "medium", "high"];

const GPT5_FAMILY_RE = /(?:^|\/)gpt-5(?:[.-]|$)/;
const GPT5_VERSION_RE = /(?:^|\/)gpt-5[.-](\d+)(?:[.-]|$)/;
const GPT5_PRO_RE = /(?:^|\/)gpt-5[.-]?pro(?:[.-]|$)/;
const GPT5_VERSIONED_PRO_RE = /(?:^|\/)gpt-5[.-]\d+[.-]pro(?:[.-]|$)/;
const OPENAI_NONE_EFFORT_RELEASE_DATE = "2025-11-13";
const OPENAI_XHIGH_EFFORT_RELEASE_DATE = "2025-12-04";

function gpt5Version(id: string): number | undefined {
	return Number(GPT5_VERSION_RE.exec(id)?.[1]) || undefined;
}

// OpenCode: openaiReasoningEfforts(apiId, releaseDate). Effort order weakest->strongest.
function openaiEfforts(id: string, releaseDate: string): string[] {
	if (id.includes("deep-research")) return ["medium"];
	if (GPT5_FAMILY_RE.test(id) && id.includes("-chat")) return gpt5Version(id) === undefined ? [] : ["medium"];
	if (GPT5_PRO_RE.test(id)) return ["high"]; // unversioned gpt-5-pro only
	if (GPT5_FAMILY_RE.test(id) && id.includes("codex")) {
		const v = gpt5Version(id);
		if (v !== undefined && v >= 3) return ["none", "low", "medium", "high", "xhigh"];
		if (id.includes("codex-max") || (v !== undefined && v >= 2)) return ["low", "medium", "high", "xhigh"];
		return [...WIDELY];
	}
	if (GPT5_VERSIONED_PRO_RE.test(id)) return ["medium", "high", "xhigh"];
	const v = gpt5Version(id);
	if (v === 1) return ["none", "low", "medium", "high"];
	if (v !== undefined && v >= 2) return ["none", "low", "medium", "high", "xhigh"];
	const efforts = [...WIDELY];
	if (GPT5_FAMILY_RE.test(id)) efforts.unshift("minimal");
	if (releaseDate >= OPENAI_NONE_EFFORT_RELEASE_DATE) efforts.unshift("none");
	if (releaseDate >= OPENAI_XHIGH_EFFORT_RELEASE_DATE) efforts.push("xhigh");
	return efforts;
}

// OpenCode: openaiCompatibleReasoningEfforts(id) — no release date available.
function openaiCompatibleEfforts(id: string): string[] {
	if (GPT5_FAMILY_RE.test(id) && id.includes("-chat")) return gpt5Version(id) === undefined ? [] : ["medium"];
	if (GPT5_PRO_RE.test(id)) return ["high"]; // unversioned gpt-5-pro only
	if (GPT5_FAMILY_RE.test(id) && id.includes("codex")) {
		const v = gpt5Version(id);
		if (v !== undefined && v >= 3) return ["none", "low", "medium", "high", "xhigh"];
		if (id.includes("codex-max") || (v !== undefined && v >= 2)) return ["low", "medium", "high", "xhigh"];
		return [...WIDELY];
	}
	if (GPT5_VERSIONED_PRO_RE.test(id)) return ["medium", "high", "xhigh"];
	const v = gpt5Version(id);
	if (v === 1) return ["none", "low", "medium", "high"];
	if (v !== undefined && v >= 2) return ["none", "low", "medium", "high", "xhigh"];
	return ["none", "minimal", ...WIDELY, "xhigh"];
}

function anthropicOpus47OrLater(id: string): boolean {
	const m = /opus-(\d+)[.-](\d+)|claude-(\d+)[.-](\d+)-opus/.exec(id);
	if (!m) return false;
	const major = Number(m[1] ?? m[3]);
	const minor = Number(m[2] ?? m[4]);
	return major > 4 || (major === 4 && minor >= 7);
}

// OpenCode: anthropicAdaptiveEfforts(apiId). null => not an adaptive model.
function anthropicAdaptiveEfforts(id: string): string[] | null {
	if (anthropicOpus47OrLater(id) || id.includes("fable-5") || id.includes("mythos-5")) {
		return ["low", "medium", "high", "xhigh", "max"];
	}
	if (["opus-4-6", "opus-4.6", "4-6-opus", "4.6-opus", "sonnet-4-6", "sonnet-4.6"].some((v) => id.includes(v))) {
		return ["low", "medium", "high", "max"];
	}
	return null;
}

// OpenCode: googleThinkingLevelEfforts(apiId) for Gemini 3.x; 2.5 uses budgets (high/max).
function googleEfforts(id: string): string[] {
	if (id.includes("2.5")) return ["high", "max"];
	if (!id.includes("gemini-3")) return ["low", "high"];
	if (id.includes("flash-image")) return ["minimal", "high"];
	if (id.includes("pro-image")) return ["high"];
	if (id.includes("flash")) return ["minimal", "low", "medium", "high"];
	return ["low", "medium", "high"];
}

// OpenCode returns {} (no graded effort tiers) for these — binary/always-on thinking.
const NO_EFFORT_ID_SUBSTRINGS = [
	"deepseek-chat",
	"deepseek-reasoner",
	"deepseek-r1",
	"deepseek-v3",
	"minimax",
	"kimi",
	"k2p",
	"qwen",
	"big-pickle",
];

function isNoEffortModel(id: string): boolean {
	// GLM is binary EXCEPT GLM-5.2+ which adds high/max effort tiers.
	if (id.includes("glm")) return !/glm-?5\.[2-9]/.test(id) && !/glm-?[6-9]/.test(id);
	if (id.includes("grok") && !id.includes("grok-3-mini")) return true;
	return NO_EFFORT_ID_SUBSTRINGS.some((s) => id.includes(s));
}

/**
 * Compute the OpenCode effort set for a model, or "binary" (off+high only), or
 * null when the model is not reasoning-capable.
 */
export function openCodeEfforts(model: ThinkingModelInput): string[] | "binary" | null {
	if (!model.reasoning) return null;
	const id = model.id.toLowerCase();
	const provider = model.provider;
	const release = model.releaseDate ?? "";

	// xAI grok-3-mini exposes low/high; other grok models have no graded tiers.
	if (id.includes("grok-3-mini")) return ["low", "high"];

	// GitHub Copilot is host-specific.
	if (provider === "github-copilot") {
		if (id.includes("gemini")) return "binary";
		if (id.includes("claude")) return [...WIDELY];
		if (id.includes("gpt-5")) {
			if (id.includes("5.1-codex-max") || id.includes("5.2") || id.includes("5.3")) return [...WIDELY, "xhigh"];
			return release >= OPENAI_XHIGH_EFFORT_RELEASE_DATE ? [...WIDELY, "xhigh"] : [...WIDELY];
		}
		return [...WIDELY];
	}

	// Anthropic (direct, Bedrock, Vertex).
	const adaptive = anthropicAdaptiveEfforts(id);
	if (adaptive) return adaptive;
	if (id.includes("claude") || (provider === "amazon-bedrock" && id.includes("anthropic"))) {
		if (id.includes("opus-4-5") || id.includes("opus-4.5")) return [...WIDELY];
		return ["high", "max"]; // older Claude: budget-based high/max
	}

	// Google Gemini / Gemma.
	if (model.api === "google-generative-ai" || model.api === "google-vertex" || provider.startsWith("google")) {
		return googleEfforts(id);
	}

	// Provider-specific sets where OpenCode is stale or absent (verified against the
	// providers' own docs — OpenCode treats all GLM as binary and omits these):
	if (provider === "ant-ling") return ["high", "xhigh"]; // Ring: documented high/xhigh only
	if (model.api === "mistral-conversations") return "binary"; // Mistral: high | none (on/off)

	// No-effort binary providers.
	if (isNoEffortModel(id)) return "binary";

	// Native OpenAI families, identified by API (openai-completions is the
	// COMPATIBLE upstream shape used by DeepSeek/Z.ai/etc — those fall through).
	if (
		model.api === "openai-responses" ||
		model.api === "azure-openai-responses" ||
		model.api === "openai-codex-responses"
	) {
		if (id === "o1-mini") return "binary";
		return openaiEfforts(id, release);
	}

	// OpenRouter / gateways: OpenAI-shaped for gpt models, widely-supported otherwise.
	if (provider === "openrouter" || provider.includes("gateway") || provider.includes("vercel")) {
		if (id.startsWith("openai/") || id.includes("gpt")) return openaiCompatibleEfforts(id);
		const efforts = [...WIDELY];
		if (id.includes("deepseek-v4")) efforts.push("max");
		return efforts;
	}

	// Default OpenAI-compatible upstreams (cerebras/together/xai/deepinfra/...).
	if (id.includes("north-mini-code")) return ["none", "high"];
	const efforts = [...WIDELY];
	if (id.includes("deepseek-v4")) efforts.push("max");
	return efforts;
}

const ALL_TIERS = ["minimal", "low", "medium", "high", "xhigh", "max"] as const;

// Models whose reasoning cannot be turned off (always-on). `off` is unavailable
// for these; everything else keeps Misul's disable capability.
function cannotDisableThinking(model: ThinkingModelInput, efforts: string[]): boolean {
	const id = model.id.toLowerCase();
	if (id.includes("kimi-k2.7-code") || id.includes("grok-build") || id.includes("qwq")) return true;
	if (id.includes("fable-5") || id.includes("mythos-5")) return true; // always-on adaptive thinking
	if (model.provider === "ant-ling") return true; // Ring reasons by default
	// GPT-5 family (any host) disables only via the "none" effort tier.
	if (GPT5_FAMILY_RE.test(id)) return !efforts.includes("none");
	if (model.api === "google-generative-ai" || model.api === "google-vertex") {
		// Gemini 3.x, Gemma 4, and 2.5 Pro cannot fully disable thinking.
		return id.includes("gemini-3") || /gemma-?4/.test(id) || (id.includes("2.5") && id.includes("pro") && !id.includes("flash"));
	}
	if (model.api === "openai-responses" || model.api === "azure-openai-responses" || model.api === "openai-codex-responses") {
		return !efforts.includes("none"); // native OpenAI disables only via the "none" tier
	}
	return false;
}

/**
 * Translate the OpenCode effort set into a Misul thinkingLevelMap: supported
 * tiers map to their effort name, others are null. `off` is supported (disable)
 * unless the model is always-on. Binary models expose off + high only. Returns
 * undefined for non-reasoning models.
 */
export function thinkingLevelMapFor(model: ThinkingModelInput): LevelMap | undefined {
	const efforts = openCodeEfforts(model);
	if (efforts === null) return undefined;

	const tiers = efforts === "binary" ? ["high"] : efforts;
	const canDisable = !cannotDisableThinking(model, tiers);

	const map: LevelMap = {};
	// off: disable supported unless always-on. OpenAI exposes it as the "none"
	// tier; elsewhere it is "run without thinking".
	map.off = canDisable ? (tiers.includes("none") ? "none" : "off") : null;
	for (const tier of ALL_TIERS) {
		map[tier] = tiers.includes(tier) ? tier : null;
	}
	return map;
}
