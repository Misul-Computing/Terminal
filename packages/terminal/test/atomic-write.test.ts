import {
	chmodSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeFileAtomic } from "../src/core/tools/atomic-write.ts";

const dirs: string[] = [];
function tmp(): string {
	const d = mkdtempSync(join(tmpdir(), "misul-atomic-"));
	dirs.push(d);
	return d;
}
afterEach(() => {
	for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("writeFileAtomic", () => {
	it("writes a new file", async () => {
		const dir = tmp();
		const f = join(dir, "new.txt");
		await writeFileAtomic(f, "hello");
		expect(readFileSync(f, "utf-8")).toBe("hello");
	});

	it("overwrites an existing file and leaves no temp file behind", async () => {
		const dir = tmp();
		const f = join(dir, "f.txt");
		writeFileSync(f, "old");
		await writeFileAtomic(f, "new");
		expect(readFileSync(f, "utf-8")).toBe("new");
		expect(readdirSync(dir)).toEqual(["f.txt"]); // temp renamed away, nothing leaked
	});

	it("preserves the file mode across the rename", async () => {
		if (process.platform === "win32") return; // NTFS doesn't honor unix mode bits
		const dir = tmp();
		const f = join(dir, "script.sh");
		writeFileSync(f, "#!/bin/sh\n");
		chmodSync(f, 0o755);
		await writeFileAtomic(f, "#!/bin/sh\necho hi\n");
		expect(statSync(f).mode & 0o777).toBe(0o755);
	});

	it("leaves the original intact and cleans up the temp when the rename fails", async () => {
		const dir = tmp();
		// A non-empty directory at the target path makes the file->target rename fail.
		const target = join(dir, "blocked");
		mkdirSync(target);
		writeFileSync(join(target, "keep.txt"), "keep");

		await expect(writeFileAtomic(target, "should not land")).rejects.toThrow();

		expect(readFileSync(join(target, "keep.txt"), "utf-8")).toBe("keep"); // original intact
		expect(readdirSync(dir)).toEqual(["blocked"]); // temp cleaned up, nothing leaked
	});

	it("writes through a symlink instead of replacing it", async () => {
		const dir = tmp();
		const target = join(dir, "target.txt");
		const link = join(dir, "link.txt");
		writeFileSync(target, "orig");
		try {
			symlinkSync(target, link);
		} catch {
			return; // symlink creation not permitted (e.g. Windows without privilege) — skip
		}
		await writeFileAtomic(link, "via-link");
		expect(lstatSync(link).isSymbolicLink()).toBe(true); // link preserved, not replaced
		expect(readFileSync(target, "utf-8")).toBe("via-link"); // written through to the target
	});
});
