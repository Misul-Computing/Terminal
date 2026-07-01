import type { SettingsManager } from "./settings-manager.ts";

/**
 * A single addon entry in the store registry.
 * `source` can be a git URL, an npm package spec, or a local path.
 */
export interface AddonStoreEntry {
	name: string;
	description: string;
	source: string; // git: URL, npm: package, or local path
	homepage?: string;
	tags?: string[];
	author?: string;
	version?: string;
}

/**
 * The shape of the registry JSON document served at an addon store URL.
 */
export interface AddonStore {
	addons: AddonStoreEntry[];
}

/**
 * Default addon registry URL. Points at the official Misul Computing store.
 */
export const DEFAULT_ADDON_STORE_URL =
	"https://raw.githubusercontent.com/misul-computing/misul-addon-store/main/registry.json";

/**
 * Resolve the addon store URL from user settings, falling back to the default.
 */
export function getAddonStoreUrl(settingsManager: SettingsManager): string {
	return settingsManager.getAddonStoreUrl() ?? DEFAULT_ADDON_STORE_URL;
}

/**
 * Fetch and parse an addon store JSON document from `url`.
 *
 * Uses the global `fetch` (Node 18+). Aborts after 10 seconds. Returns an
 * empty store on any failure (network error, non-OK status, invalid JSON,
 * or a document without an `addons` array) so callers can always iterate.
 */
export async function fetchAddonStore(url: string): Promise<AddonStore> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 10_000);

	try {
		const response = await fetch(url, { signal: controller.signal });
		if (!response.ok) {
			return { addons: [] };
		}
		const text = await response.text();
		let parsed: unknown;
		try {
			parsed = JSON.parse(text);
		} catch {
			return { addons: [] };
		}
		if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as AddonStore).addons)) {
			return { addons: [] };
		}
		return normalizeStore(parsed as AddonStore);
	} catch {
		return { addons: [] };
	} finally {
		clearTimeout(timeout);
	}
}

/**
 * Keep only entries with the required fields so downstream code can trust
 * the shape. Invalid entries are dropped silently.
 */
function normalizeStore(store: AddonStore): AddonStore {
	const addons = store.addons.filter(
		(entry): entry is AddonStoreEntry =>
			typeof entry?.name === "string" &&
			typeof entry?.description === "string" &&
			typeof entry?.source === "string",
	);
	return { addons };
}

/**
 * Case-insensitive fuzzy search over name, description, and tags.
 *
 * A query matches an entry when every whitespace-separated query token is a
 * substring of the entry's name, description, or any tag (all compared
 * case-insensitively). Results preserve registry order.
 */
export function searchAddons(store: AddonStore, query: string): AddonStoreEntry[] {
	const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
	if (tokens.length === 0) {
		return store.addons;
	}

	return store.addons.filter((entry) => {
		const haystack = [
			entry.name,
			entry.description,
			...(entry.tags ?? []),
		]
			.join(" ")
			.toLowerCase();
		return tokens.every((token) => haystack.includes(token));
	});
}
