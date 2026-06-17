/** Shared wiring for offline faux-provider eval tests (zero API cost). */

import { registerFauxProvider } from "@earendil-works/pi-ai";
import { AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";

export interface FauxRig {
	faux: ReturnType<typeof registerFauxProvider>;
	authStorage: AuthStorage;
	modelRegistry: ModelRegistry;
	model: ReturnType<ReturnType<typeof registerFauxProvider>["getModel"]>;
}

/** Register a faux provider and a matching in-memory auth/model registry. */
export function createFauxRig(): FauxRig {
	const faux = registerFauxProvider({
		models: [{ id: "faux-1", cost: { input: 0.000001, output: 0.000002, cacheRead: 0, cacheWrite: 0 } }],
	});
	const model = faux.getModel();
	const authStorage = AuthStorage.inMemory();
	authStorage.setRuntimeApiKey(model.provider, "faux-key");
	const modelRegistry = ModelRegistry.inMemory(authStorage);
	modelRegistry.registerProvider(model.provider, {
		baseUrl: model.baseUrl,
		apiKey: "faux-key",
		api: faux.api,
		models: faux.models.map((m) => ({
			id: m.id,
			name: m.name,
			api: m.api,
			reasoning: m.reasoning,
			input: m.input,
			cost: m.cost,
			contextWindow: m.contextWindow,
			maxTokens: m.maxTokens,
			baseUrl: m.baseUrl,
		})),
	});
	return { faux, authStorage, modelRegistry, model };
}
