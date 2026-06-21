/**
 * Tool-path resolution caching (fast-search perf).
 *
 * grep (ripgrep) and find (fd) resolve their binary via getToolPath() on every
 * call. When the binary lives on the system PATH, resolution spawns
 * `<tool> --version` to confirm existence. That probe is pure per-call latency,
 * so resolved paths are memoized for the process lifetime. These tests pin that
 * behavior: a resolved path is probed once, and a *failed* resolution is never
 * cached (so a later download is still picked up).
 */
import { spawnSync } from "child_process";
import { existsSync } from "fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { __resetToolPathCache, getToolPath } from "../src/utils/tools-manager.ts";

vi.mock("child_process", async (importOriginal) => ({
	...(await importOriginal<typeof import("child_process")>()),
	spawnSync: vi.fn(),
}));
vi.mock("fs", async (importOriginal) => ({
	...(await importOriginal<typeof import("fs")>()),
	existsSync: vi.fn(() => false),
}));

const spawnSyncMock = vi.mocked(spawnSync);
const existsSyncMock = vi.mocked(existsSync);

afterEach(() => {
	vi.clearAllMocks();
	__resetToolPathCache();
});

describe("getToolPath caching", () => {
	it("probes the system PATH once, then serves the resolved path from cache", () => {
		existsSyncMock.mockReturnValue(false); // not in local bin dir -> fall through to PATH
		spawnSyncMock.mockReturnValue({ error: null, status: 0 } as never); // `rg --version` succeeds

		expect(getToolPath("rg")).toBe("rg");
		expect(spawnSyncMock.mock.calls.length).toBeGreaterThan(0);

		spawnSyncMock.mockClear();
		expect(getToolPath("rg")).toBe("rg");
		expect(spawnSyncMock).not.toHaveBeenCalled(); // served from cache, no new probe
	});

	it("does not cache a failed resolution", () => {
		existsSyncMock.mockReturnValue(false);
		spawnSyncMock.mockReturnValue({ error: new Error("ENOENT"), status: null } as never);
		expect(getToolPath("fd")).toBeNull();

		// fd becomes available later (e.g. downloaded); a fresh call must re-resolve it.
		spawnSyncMock.mockReturnValue({ error: null, status: 0 } as never);
		expect(getToolPath("fd")).toBe("fd");
	});
});
