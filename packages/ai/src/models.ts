import { MODELS } from "./models.generated.ts";
import type { Api, KnownProvider, Model, ModelThinkingLevel, Usage } from "./types.ts";

const modelRegistry: Map<string, Map<string, Model<Api>>> = new Map();

// Initialize registry from MODELS on module load
for (const [provider, models] of Object.entries(MODELS)) {
	const providerModels = new Map<string, Model<Api>>();
	for (const [id, model] of Object.entries(models)) {
		providerModels.set(id, model as Model<Api>);
	}
	modelRegistry.set(provider, providerModels);
}

type ModelApi<
	TProvider extends KnownProvider,
	TModelId extends keyof (typeof MODELS)[TProvider],
> = (typeof MODELS)[TProvider][TModelId] extends { api: infer TApi } ? (TApi extends Api ? TApi : never) : never;

export function getModel<TProvider extends KnownProvider, TModelId extends keyof (typeof MODELS)[TProvider]>(
	provider: TProvider,
	modelId: TModelId,
): Model<ModelApi<TProvider, TModelId>> {
	const providerModels = modelRegistry.get(provider);
	return providerModels?.get(modelId as string) as Model<ModelApi<TProvider, TModelId>>;
}

export function getProviders(): KnownProvider[] {
	return Array.from(modelRegistry.keys()) as KnownProvider[];
}

export function getModels<TProvider extends KnownProvider>(
	provider: TProvider,
): Model<ModelApi<TProvider, keyof (typeof MODELS)[TProvider]>>[] {
	const models = modelRegistry.get(provider);
	return models ? (Array.from(models.values()) as Model<ModelApi<TProvider, keyof (typeof MODELS)[TProvider]>>[]) : [];
}

export function calculateCost<TApi extends Api>(model: Model<TApi>, usage: Usage): Usage["cost"] {
	// Anthropic charges 2x base input for 1h cache writes.
	const longWrite = usage.cacheWrite1h ?? 0;
	const shortWrite = usage.cacheWrite - longWrite;
	usage.cost.input = (model.cost.input / 1000000) * usage.input;
	usage.cost.output = (model.cost.output / 1000000) * usage.output;
	usage.cost.cacheRead = (model.cost.cacheRead / 1000000) * usage.cacheRead;
	usage.cost.cacheWrite = (model.cost.cacheWrite * shortWrite + model.cost.input * 2 * longWrite) / 1000000;
	usage.cost.total = usage.cost.input + usage.cost.output + usage.cost.cacheRead + usage.cost.cacheWrite;
	return usage.cost;
}

/** Concrete thinking levels excluding meta-levels like "auto". */
type ConcreteThinkingLevel = Exclude<ModelThinkingLevel, "auto">;

const EXTENDED_THINKING_LEVELS: ConcreteThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

export function getSupportedThinkingLevels<TApi extends Api>(model: Model<TApi>): ConcreteThinkingLevel[] {
	if (!model.reasoning) return ["off"];

	return EXTENDED_THINKING_LEVELS.filter((level) => {
		const mapped = model.thinkingLevelMap?.[level];
		if (mapped === null) return false;
		// `xhigh` and `max` are narrow top tiers only specific models expose, so they
		// are opt-in: offered only when the model explicitly maps them.
		if (level === "xhigh" || level === "max") return mapped !== undefined;
		return true;
	});
}

const GENERIC_THINKING_LEVEL_NAMES = new Set<string>(EXTENDED_THINKING_LEVELS);

/**
 * Human-facing label for a thinking level on a specific model — the single
 * source of truth for displaying a level anywhere in the UI (selector, footer,
 * status, tree, settings).
 *
 * Surfaces the provider's own mode name when it is a distinct word (e.g. the
 * budget-based top tier is "max" on Anthropic/DeepSeek), so the UI shows what
 * the provider actually calls the mode. Falls back to the generic effort level
 * otherwise — and never surfaces a provider value that is itself a generic level
 * name (so a `minimal → "low"` alias can't collide with the real `low`), nor an
 * internal value like "default"/"none" or a numeric budget.
 */
export function thinkingLevelLabel<TApi extends Api>(
	model: Model<TApi> | undefined,
	level: ModelThinkingLevel,
): string {
	const mapped = model?.thinkingLevelMap?.[level];
	if (typeof mapped === "string") {
		const term = mapped.toLowerCase();
		if (/^[a-z]+$/.test(term) && !GENERIC_THINKING_LEVEL_NAMES.has(term) && term !== "default" && term !== "none") {
			return term;
		}
	}
	return level;
}

export function clampThinkingLevel<TApi extends Api>(
	model: Model<TApi>,
	level: ModelThinkingLevel,
): ConcreteThinkingLevel {
	const availableLevels = getSupportedThinkingLevels(model);
	if (availableLevels.includes(level as ConcreteThinkingLevel)) return level as ConcreteThinkingLevel;

	const requestedIndex = EXTENDED_THINKING_LEVELS.indexOf(level as ConcreteThinkingLevel);
	if (requestedIndex === -1) return availableLevels[0] ?? "off";

	for (let i = requestedIndex; i < EXTENDED_THINKING_LEVELS.length; i++) {
		const candidate = EXTENDED_THINKING_LEVELS[i];
		if (availableLevels.includes(candidate)) return candidate;
	}
	for (let i = requestedIndex - 1; i >= 0; i--) {
		const candidate = EXTENDED_THINKING_LEVELS[i];
		if (availableLevels.includes(candidate)) return candidate;
	}
	return availableLevels[0] ?? "off";
}

/**
 * Check if two models are equal by comparing both their id and provider.
 * Returns false if either model is null or undefined.
 */
export function modelsAreEqual<TApi extends Api>(
	a: Model<TApi> | null | undefined,
	b: Model<TApi> | null | undefined,
): boolean {
	if (!a || !b) return false;
	return a.id === b.id && a.provider === b.provider;
}
