import { describe, expect, test } from "vitest";
import { type ChangelogEntry, normalizeChangelogLinks } from "../src/utils/changelog.ts";

const entry: ChangelogEntry = {
	major: 0,
	minor: 79,
	patch: 0,
	content: "",
};

describe("normalizeChangelogLinks", () => {
	test("rewrites package-relative changelog links to tag-pinned GitHub source links", () => {
		const markdown = [
			"[Project Trust](README.md#project-trust)",
			"[Extensions](docs/extensions.md#project_trust)",
			"[Examples](examples/extensions/)",
			"[Root README](../../README.md#supply-chain-hardening)",
		].join("\n");

		expect(normalizeChangelogLinks(markdown, entry)).toBe(
			[
				"[Project Trust](https://github.com/Misul-Computing/Terminal/blob/v0.79.0/packages/terminal/README.md#project-trust)",
				"[Extensions](https://github.com/Misul-Computing/Terminal/blob/v0.79.0/packages/terminal/docs/extensions.md#project_trust)",
				"[Examples](https://github.com/Misul-Computing/Terminal/tree/v0.79.0/packages/terminal/examples/extensions/)",
				"[Root README](https://github.com/Misul-Computing/Terminal/blob/v0.79.0/README.md#supply-chain-hardening)",
			].join("\n"),
		);
	});

	test("pin floating branch refs to tag-pinned GitHub source links", () => {
		const markdown = [
			"[Agent README](https://github.com/Misul-Computing/Terminal/blob/main/packages/agent/README.md)",
			"[External](https://example.com/docs)",
			"[Local anchor](#settings)",
		].join("\n");

		expect(normalizeChangelogLinks(markdown, "0.79.0")).toBe(
			[
				"[Agent README](https://github.com/Misul-Computing/Terminal/blob/v0.79.0/packages/agent/README.md)",
				"[External](https://example.com/docs)",
				"[Local anchor](#settings)",
			].join("\n"),
		);
	});
});
