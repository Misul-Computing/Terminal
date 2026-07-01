/**
 * MCP tool cache stability tests.
 *
 * Verifies that MCP tool descriptions are sanitized of non-deterministic
 * content (absolute paths, port numbers, tokens) so the tool schema block
 * stays byte-identical across restarts and reconnects.
 *
 * See docs/cache-aware-design.md: "MCP tools: ... strip runtime paths/ports/
 * tokens from descriptions."
 */
import { describe, expect, it } from "vitest";
import { sanitizeMcpDescription } from "../src/core/mcp-client.ts";

describe("MCP description sanitization for cache stability", () => {
	it("strips absolute POSIX paths from descriptions", () => {
		const desc = "Runs a search in /tmp/misul-mcp-abc123/data";
		const sanitized = sanitizeMcpDescription(desc);
		expect(sanitized).not.toContain("/tmp/misul-mcp-abc123");
		expect(sanitized).not.toContain("/tmp/");
	});

	it("strips absolute Windows paths from descriptions", () => {
		const desc = "Reads config from C:\\Users\\dev\\config.json";
		const sanitized = sanitizeMcpDescription(desc);
		expect(sanitized).not.toContain("C:\\Users");
	});

	it("strips port numbers from URLs in descriptions", () => {
		const desc = "Connects to http://localhost:8080/api";
		const sanitized = sanitizeMcpDescription(desc);
		expect(sanitized).not.toContain(":8080");
		expect(sanitized).toContain("http://localhost");
	});

	it("strips tokens and API keys from URLs", () => {
		const desc = "Fetches from http://api.example.com?token=secret123";
		const sanitized = sanitizeMcpDescription(desc);
		expect(sanitized).not.toContain("secret123");
		expect(sanitized).not.toContain("token=secret123");
	});

	it("produces identical output for descriptions that differ only in temp paths", () => {
		const desc1 = "Process files in /tmp/misul-aaa/output directory";
		const desc2 = "Process files in /tmp/misul-bbb/output directory";
		expect(sanitizeMcpDescription(desc1)).toBe(sanitizeMcpDescription(desc2));
	});

	it("produces identical output for descriptions that differ only in port numbers", () => {
		const desc1 = "Server at http://localhost:3000";
		const desc2 = "Server at http://localhost:4000";
		expect(sanitizeMcpDescription(desc1)).toBe(sanitizeMcpDescription(desc2));
	});

	it("leaves stable descriptions unchanged", () => {
		const desc = "List files in a directory. Returns file names and sizes.";
		expect(sanitizeMcpDescription(desc)).toBe(desc);
	});

	it("handles empty and undefined-like descriptions", () => {
		expect(sanitizeMcpDescription("")).toBe("");
	});
});
