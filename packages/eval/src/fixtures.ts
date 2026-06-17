/** Load Tier-1 eval fixtures from disk and validate their contract. */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { EvalFixture, FixtureMetadata } from "./types.ts";

export interface LoadFixturesOptions {
	/** When provided, only fixtures whose id is in this list are loaded. */
	ids?: string[];
}

/**
 * Load fixtures under `root`. Each fixture directory must contain
 * `prompt.md`, `metadata.json` (with a `testCommand`), and an `input/`
 * subtree. Invalid directories are skipped rather than throwing so one
 * malformed fixture cannot break a whole run.
 */
export function loadFixtures(root: string, options: LoadFixturesOptions = {}): EvalFixture[] {
	const wanted = options.ids ? new Set(options.ids) : undefined;
	const fixtures: EvalFixture[] = [];

	for (const id of readdirSync(root).sort()) {
		if (wanted && !wanted.has(id)) continue;
		const dir = join(root, id);
		if (!statSync(dir).isDirectory()) continue;

		const promptPath = join(dir, "prompt.md");
		const metadataPath = join(dir, "metadata.json");
		const inputDir = join(dir, "input");
		if (!existsSync(promptPath) || !existsSync(metadataPath) || !existsSync(inputDir)) continue;

		let metadata: FixtureMetadata;
		try {
			metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
		} catch {
			continue;
		}
		if (!metadata.testCommand) continue;

		fixtures.push({
			id,
			dir,
			prompt: readFileSync(promptPath, "utf8"),
			inputDir,
			metadata,
		});
	}

	return fixtures;
}
