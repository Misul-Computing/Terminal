import { getEnv } from "../config.ts";

export function areExperimentalFeaturesEnabled(): boolean {
	return getEnv("EXPERIMENTAL") === "1";
}
