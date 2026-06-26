import { describe, expect, it } from "vitest";
import { getMisulUserAgent } from "../src/utils/user-agent.ts";

describe("getMisulUserAgent", () => {
	it("formats the user agent expected by misul.dev", () => {
		const runtime = process.versions.bun ? `bun/${process.versions.bun}` : `node/${process.version}`;
		const userAgent = getMisulUserAgent("1.2.3");

		expect(userAgent).toBe(`misul/1.2.3 (${process.platform}; ${runtime}; ${process.arch})`);
		expect(userAgent).toMatch(/^misul\/[^\s()]+ \([^;()]+;\s*[^;()]+;\s*[^()]+\)$/);
	});
});
