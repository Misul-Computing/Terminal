import { chmod, lstat, rename, rm, writeFile } from "fs/promises";
import { basename, dirname, join } from "node:path";

/** Brief backoff for transient locks (Windows AV/indexer/editor) holding the target during rename. */
const RENAME_RETRY_DELAYS_MS = [10, 30, 90];

function isLockError(err: unknown): boolean {
	const code = (err as NodeJS.ErrnoException | undefined)?.code;
	return code === "EPERM" || code === "EBUSY" || code === "EACCES";
}

async function renameWithRetry(tmp: string, target: string): Promise<void> {
	for (let attempt = 0; ; attempt++) {
		try {
			await rename(tmp, target);
			return;
		} catch (err) {
			if (attempt >= RENAME_RETRY_DELAYS_MS.length || !isLockError(err)) throw err;
			await new Promise((resolve) => setTimeout(resolve, RENAME_RETRY_DELAYS_MS[attempt]));
		}
	}
}

/**
 * Write a file atomically: write a fresh temp file in the same directory, then rename over the
 * target. The original is never truncated, so a crash or a flaky network/cloud-synced drive can't
 * leave a 0-byte/truncated file — on failure the original stays intact and the error surfaces
 * (temp is cleaned up). Symlinks are written through directly (rename would replace the link); the
 * existing file's mode (e.g. an executable bit) is preserved across the rename. Rename is retried a
 * few times on transient lock errors (common on Windows).
 *
 * Tradeoff: hardlinked targets diverge after a write (rename gives the path a fresh inode) — the
 * standard, accepted cost of atomic writes; vanishingly rare in source trees.
 */
export async function writeFileAtomic(path: string, content: string): Promise<void> {
	const existing = await lstat(path).catch(() => undefined);
	if (existing?.isSymbolicLink()) {
		await writeFile(path, content, "utf-8");
		return;
	}
	const tmp = join(dirname(path), `.${basename(path)}.tmp-${process.pid}-${Date.now()}`);
	try {
		await writeFile(tmp, content, "utf-8");
		if (existing) await chmod(tmp, existing.mode).catch(() => {});
		await renameWithRetry(tmp, path);
	} catch (err) {
		await rm(tmp, { force: true }).catch(() => {});
		throw err;
	}
}
