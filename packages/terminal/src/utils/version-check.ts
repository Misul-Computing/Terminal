import { compare, valid } from "semver";

export interface LatestRelease {
	version: string;
	packageName?: string;
	note?: string;
}

export function comparePackageVersions(leftVersion: string, rightVersion: string): number | undefined {
	const left = valid(leftVersion.trim());
	const right = valid(rightVersion.trim());
	if (!left || !right) {
		return undefined;
	}
	return compare(left, right);
}

export function isNewerPackageVersion(candidateVersion: string, currentVersion: string): boolean {
	const comparison = comparePackageVersions(candidateVersion, currentVersion);
	if (comparison !== undefined) {
		return comparison > 0;
	}
	return candidateVersion.trim() !== currentVersion.trim();
}

export async function getLatestRelease(
	_currentVersion: string,
	_options: { timeoutMs?: number } = {},
): Promise<LatestRelease | undefined> {
	// Misul Terminal has no release feed of its own and must never poll a
	// third-party endpoint or self-update to a foreign package. Release
	// discovery is disabled until a Misul Computing release endpoint exists.
	return undefined;
}

export async function getLatestVersion(
	currentVersion: string,
	options: { timeoutMs?: number } = {},
): Promise<string | undefined> {
	return (await getLatestRelease(currentVersion, options))?.version;
}

export async function checkForNewVersion(currentVersion: string): Promise<LatestRelease | undefined> {
	try {
		const latestRelease = await getLatestRelease(currentVersion);
		if (latestRelease && isNewerPackageVersion(latestRelease.version, currentVersion)) {
			return latestRelease;
		}
		return undefined;
	} catch {
		return undefined;
	}
}
