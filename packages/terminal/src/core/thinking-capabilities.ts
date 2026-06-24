/**
 * Runtime cache of probed thinking-effort capabilities per model.
 *
 * The build-time `thinkingLevelMap` in `models.generated.ts` is a best-effort
 * heuristic. The `/probe-thinking` command sends a minimal request per effort
 * tier to discover what the provider actually accepts, and stores the result
 * here. `getAvailableThinkingLevels` checks this cache first, so the selector
 * reflects runtime-discovered capabilities without requiring a CLI update.
 *
 * The cache is in-process (persists across turns within a session). Cross-session
 * persistence can be layered on via settings.
 */

import type { Model, ModelThinkingLevel, ThinkingLevel } from "@misul/ai";
import { getSupportedThinkingLevels } from "@misul/ai";

// modelKey → set of supported effort tiers (without "off"; off is always
// supported unless the model is always-on, which the build-time map already
// encodes).
const probeCache = new Map<string, Set<ThinkingLevel>>();

function modelKey(model: Model<any>): string {
	return `${model.provider}/${model.id}`;
}

/** Record probed capabilities for a model. `tiers` excludes "off". */
export function recordProbedThinkingLevels(model: Model<any>, tiers: ThinkingLevel[]): void {
	probeCache.set(modelKey(model), new Set<ThinkingLevel>(tiers));
}

/** Check whether a model has been probed. */
export function isModelProbed(model: Model<any>): boolean {
	return probeCache.has(modelKey(model));
}

/**
 * Get the runtime-discovered thinking levels for a model, or `undefined` if the
 * model hasn't been probed. Callers fall back to the build-time map when this
 * returns undefined.
 */
export function getProbedThinkingLevels(model: Model<any>): ModelThinkingLevel[] | undefined {
	const probed = probeCache.get(modelKey(model));
	if (!probed) return undefined;

	// Start from the build-time levels (which include "off" gating for always-on
	// models) and filter to only those the probe confirmed.
	const buildTime = getSupportedThinkingLevels(model);
	return buildTime.filter((level) => level === "off" || probed.has(level as ThinkingLevel));
}

/** Clear the probe cache for a model (e.g. after a model change). */
export function clearProbedThinkingLevels(model: Model<any>): void {
	probeCache.delete(modelKey(model));
}

/** All tiers the probe command tests. Excludes "off", which disables thinking rather than setting an effort. */
export const PROBE_TIERS: ThinkingLevel[] = ["minimal", "low", "medium", "high", "xhigh", "max"];
