/**
 * Single source of truth for built-in provider metadata.
 *
 * Adding a new built-in provider:
 * 1. Add an entry here (name, envVars, defaultModel, oauth)
 * 2. Add models to models.generated.ts (or generate-models.ts)
 * 3. If OAuth, create the provider in utils/oauth/ and register it in utils/oauth/index.ts
 *
 * KnownProvider, env-api-keys, provider-display-names, and defaultModelPerProvider
 * all derive from this registry.
 */

export type ProviderRegistryEntry = {
	/** Display name shown in UI */
	name: string;
	/** API key env vars in priority order. Omit for OAuth-only or special auth (bedrock, vertex). */
	envVars?: string[];
	/** Default model ID for this provider */
	defaultModel: string;
	/** Has an OAuth login flow registered in utils/oauth/ */
	oauth?: boolean;
};

const entry = (e: ProviderRegistryEntry): ProviderRegistryEntry => e;

export const PROVIDERS = {
	"amazon-bedrock": entry({
		name: "Amazon Bedrock",
		defaultModel: "us.anthropic.claude-opus-4-6-v1",
	}),
	anthropic: entry({
		name: "Anthropic",
		envVars: ["ANTHROPIC_API_KEY"],
		defaultModel: "claude-opus-4-8",
		oauth: true,
	}),
	"azure-openai-responses": entry({
		name: "Azure OpenAI Responses",
		envVars: ["AZURE_OPENAI_API_KEY"],
		defaultModel: "gpt-5.4",
	}),
	"cline-pass": entry({
		name: "ClinePass",
		defaultModel: "glm-5.2",
		oauth: true,
	}),
	"cloudflare-ai-gateway": entry({
		name: "Cloudflare AI Gateway",
		envVars: ["CLOUDFLARE_API_KEY"],
		defaultModel: "workers-ai/@cf/moonshotai/kimi-k2.6",
	}),
	"cloudflare-workers-ai": entry({
		name: "Cloudflare Workers AI",
		envVars: ["CLOUDFLARE_API_KEY"],
		defaultModel: "@cf/moonshotai/kimi-k2.6",
	}),
	deepseek: entry({
		name: "DeepSeek",
		envVars: ["DEEPSEEK_API_KEY"],
		defaultModel: "deepseek-v4-pro",
	}),
	fireworks: entry({
		name: "Fireworks",
		envVars: ["FIREWORKS_API_KEY"],
		defaultModel: "accounts/fireworks/models/kimi-k2p6",
	}),
	"github-copilot": entry({
		name: "GitHub Copilot",
		envVars: ["COPILOT_GITHUB_TOKEN"],
		defaultModel: "gpt-5.4",
		oauth: true,
	}),
	google: entry({
		name: "Google Gemini",
		envVars: ["GEMINI_API_KEY"],
		defaultModel: "gemini-3.1-pro-preview",
	}),
	"google-vertex": entry({
		name: "Google Vertex AI",
		envVars: ["GOOGLE_CLOUD_API_KEY"],
		defaultModel: "gemini-3.1-pro-preview",
	}),
	groq: entry({
		name: "Groq",
		envVars: ["GROQ_API_KEY"],
		defaultModel: "openai/gpt-oss-120b",
	}),
	huggingface: entry({
		name: "Hugging Face",
		envVars: ["HF_TOKEN"],
		defaultModel: "moonshotai/Kimi-K2.6",
	}),
	"kimi-coding": entry({
		name: "Kimi For Coding",
		envVars: ["KIMI_API_KEY"],
		defaultModel: "kimi-for-coding",
	}),
	minimax: entry({
		name: "MiniMax",
		envVars: ["MINIMAX_API_KEY"],
		defaultModel: "MiniMax-M2.7",
	}),
	mistral: entry({
		name: "Mistral",
		envVars: ["MISTRAL_API_KEY"],
		defaultModel: "devstral-medium-latest",
	}),
	moonshotai: entry({
		name: "Moonshot AI",
		envVars: ["MOONSHOT_API_KEY"],
		defaultModel: "kimi-k2.6",
	}),
	nvidia: entry({
		name: "NVIDIA NIM",
		envVars: ["NVIDIA_API_KEY"],
		defaultModel: "nvidia/nemotron-3-super-120b-a12b",
	}),
	openai: entry({
		name: "OpenAI",
		envVars: ["OPENAI_API_KEY"],
		defaultModel: "gpt-5.4",
	}),
	"openai-codex": entry({
		name: "OpenAI Codex",
		defaultModel: "gpt-5.5",
		oauth: true,
	}),
	opencode: entry({
		name: "OpenCode",
		envVars: ["OPENCODE_API_KEY"],
		defaultModel: "kimi-k2.6",
	}),
	openrouter: entry({
		name: "OpenRouter",
		envVars: ["OPENROUTER_API_KEY"],
		defaultModel: "moonshotai/kimi-k2.6",
	}),
	together: entry({
		name: "Together AI",
		envVars: ["TOGETHER_API_KEY"],
		defaultModel: "moonshotai/Kimi-K2.6",
	}),
	"vercel-ai-gateway": entry({
		name: "Vercel AI Gateway",
		envVars: ["AI_GATEWAY_API_KEY"],
		defaultModel: "zai/glm-5.1",
	}),
	xai: entry({
		name: "xAI",
		envVars: ["XAI_API_KEY"],
		defaultModel: "grok-4.20-0309-reasoning",
	}),
	xiaomi: entry({
		name: "Xiaomi MiMo",
		envVars: ["XIAOMI_API_KEY"],
		defaultModel: "mimo-v2.5-pro",
	}),
	zai: entry({
		name: "ZAI",
		envVars: ["ZAI_API_KEY"],
		defaultModel: "glm-5.1",
	}),
} as const satisfies Record<string, ProviderRegistryEntry>;
