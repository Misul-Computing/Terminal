import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const cli = join(here, "..", "dist", "cli.js");

describe("misul cli smoke", () => {
	it("has a built cli entrypoint", () => {
		expect(existsSync(cli)).toBe(true);
	});

	it("runs --help and exits cleanly", () => {
		const out = execFileSync(process.execPath, [cli, "--help"], { encoding: "utf8" });
		expect(out.length).toBeGreaterThan(0);
	});

	it("identifies as Misul, not misul, in the --help banner", () => {
		const out = execFileSync(process.execPath, [cli, "--help"], { encoding: "utf8" }).toLowerCase();
		expect(out).toContain("misul");
	});
});
