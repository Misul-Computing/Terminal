import { afterEach, describe, expect, it, vi } from "vitest";
import {
	checkForNewVersion,
	comparePackageVersions,
	getLatestRelease,
	getLatestVersion,
	isNewerPackageVersion,
} from "../src/utils/version-check.ts";

const originalSkipVersionCheck = process.env.MISUL_SKIP_VERSION_CHECK;
const originalOffline = process.env.MISUL_OFFLINE;

afterEach(() => {
	vi.unstubAllGlobals();
	if (originalSkipVersionCheck === undefined) {
		delete process.env.MISUL_SKIP_VERSION_CHECK;
	} else {
		process.env.MISUL_SKIP_VERSION_CHECK = originalSkipVersionCheck;
	}
	if (originalOffline === undefined) {
		delete process.env.MISUL_OFFLINE;
	} else {
		process.env.MISUL_OFFLINE = originalOffline;
	}
});

describe("version checks", () => {
	it("compares package versions", () => {
		expect(comparePackageVersions("0.70.6", "0.70.5")).toBeGreaterThan(0);
		expect(comparePackageVersions("0.70.5", "0.70.5")).toBe(0);
		expect(comparePackageVersions("0.70.4", "0.70.5")).toBeLessThan(0);
		expect(comparePackageVersions("5.0.0-beta.20", "5.0.0-beta.9")).toBeGreaterThan(0);
		expect(isNewerPackageVersion("0.70.5", "0.70.5")).toBe(false);
		expect(isNewerPackageVersion("0.70.6", "0.70.5")).toBe(true);
	});

	it("does not poll any release endpoint (release discovery disabled)", async () => {
		// Misul Terminal is its own agent with no misul.dev release feed; it must never
		// phone home or self-update to a foreign package. All discovery returns
		// undefined without making a network call, regardless of what an endpoint
		// would return.
		const fetchMock = vi.fn(async () => Response.json({ version: "9.9.9", packageName: "@new-scope/misul" }));
		vi.stubGlobal("fetch", fetchMock);

		await expect(getLatestRelease("1.2.3")).resolves.toBeUndefined();
		await expect(getLatestVersion("1.2.3")).resolves.toBeUndefined();
		await expect(checkForNewVersion("1.2.2")).resolves.toBeUndefined();
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
