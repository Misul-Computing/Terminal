// Per-project long-term memory backed by libSQL (Turso). Local-first:
// uses a file: URL by default. Optional Turso sync if the user configures
// TURSO_DATABASE_URL and TURSO_AUTH_TOKEN in their environment.
//
// Each project gets its own database keyed by a hash of the absolute cwd.
// Memories are conservative: facts, decisions, lessons, conventions.
// Not a conversation diary.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createClient, type Client } from "@libsql/client";

export type MemoryKind = "fact" | "decision" | "lesson" | "convention";

export interface MemoryEntry {
	id: number;
	kind: MemoryKind;
	content: string;
	source: string | null;
	created_at: number;
	accessed_at: number;
	access_count: number;
	tags: string | null;
}

export interface AddMemoryOptions {
	kind: MemoryKind;
	content: string;
	tags?: string;
	source?: string;
}

export interface MemoryStoreOptions {
	cwd: string;
	agentDir?: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS memories (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	kind TEXT NOT NULL,
	content TEXT NOT NULL,
	source TEXT,
	created_at INTEGER NOT NULL,
	accessed_at INTEGER NOT NULL,
	access_count INTEGER DEFAULT 0,
	tags TEXT
);
CREATE INDEX IF NOT EXISTS idx_kind ON memories(kind);
CREATE INDEX IF NOT EXISTS idx_tags ON memories(tags);
`;

function projectHash(cwd: string): string {
	return createHash("sha256").update(cwd, "utf8").digest("hex").slice(0, 16);
}

function now(): number {
	return Math.floor(Date.now() / 1000);
}

function defaultAgentDir(): string {
	const envDir = process.env.MISUL_AGENT_DIR;
	if (envDir) return envDir;
	const home = process.env.HOME || process.env.USERPROFILE || "";
	return join(home, ".misul", "agent");
}

function rowToEntry(row: Record<string, unknown>): MemoryEntry {
	return {
		id: Number(row.id),
		kind: row.kind as MemoryKind,
		content: String(row.content),
		source: row.source as string | null,
		created_at: Number(row.created_at),
		accessed_at: Number(row.accessed_at),
		access_count: Number(row.access_count),
		tags: row.tags as string | null,
	};
}

export class MemoryStore {
	private _client: Client;
	private _closed = false;

	private constructor(client: Client) {
		this._client = client;
	}

	static async create(options: MemoryStoreOptions): Promise<MemoryStore> {
		const agentDir = options.agentDir ?? defaultAgentDir();
		const dir = join(agentDir, "memory");
		if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

		const hash = projectHash(options.cwd);
		const dbPath = join(dir, `${hash}.db`);
		const url = `file:${dbPath}`;

		// Optional Turso sync: if the user has both env vars set, sync
		// local file with a remote Turso database. This is invisible
		// to the user - they just set env vars and memory syncs.
		const syncUrl = process.env.TURSO_DATABASE_URL;
		const authToken = process.env.TURSO_AUTH_TOKEN;

		const client = createClient(
			syncUrl && authToken
				? { url, syncUrl, authToken, syncInterval: 60000 }
				: { url },
		);

		await client.executeMultiple(SCHEMA);
		return new MemoryStore(client);
	}

	async add(options: AddMemoryOptions): Promise<MemoryEntry> {
		const ts = now();
		const result = await this._client.execute({
			sql: "INSERT INTO memories (kind, content, source, created_at, accessed_at, access_count, tags) VALUES (?, ?, ?, ?, ?, 0, ?)",
			args: [options.kind, options.content, options.source ?? null, ts, ts, options.tags ?? null],
		});
		const id = Number(result.lastInsertRowid);
		return {
			id,
			kind: options.kind,
			content: options.content,
			source: options.source ?? null,
			created_at: ts,
			accessed_at: ts,
			access_count: 0,
			tags: options.tags ?? null,
		};
	}

	async search(query: string, limit = 20): Promise<MemoryEntry[]> {
		const pattern = `%${query}%`;
		const result = await this._client.execute({
			sql: "SELECT * FROM memories WHERE content LIKE ? OR tags LIKE ? ORDER BY access_count DESC, created_at DESC LIMIT ?",
			args: [pattern, pattern, limit],
		});
		const entries = result.rows.map(rowToEntry);
		await this._touch(entries);
		return entries;
	}

	async recent(limit = 20): Promise<MemoryEntry[]> {
		const result = await this._client.execute({
			sql: "SELECT * FROM memories ORDER BY created_at DESC LIMIT ?",
			args: [limit],
		});
		const entries = result.rows.map(rowToEntry);
		await this._touch(entries);
		return entries;
	}

	async byKind(kind: MemoryKind, limit = 20): Promise<MemoryEntry[]> {
		const result = await this._client.execute({
			sql: "SELECT * FROM memories WHERE kind = ? ORDER BY created_at DESC LIMIT ?",
			args: [kind, limit],
		});
		const entries = result.rows.map(rowToEntry);
		await this._touch(entries);
		return entries;
	}

	async top(limit = 10): Promise<MemoryEntry[]> {
		const result = await this._client.execute({
			sql: "SELECT * FROM memories ORDER BY access_count DESC, created_at DESC LIMIT ?",
			args: [limit],
		});
		const entries = result.rows.map(rowToEntry);
		await this._touch(entries);
		return entries;
	}

	async delete(id: number): Promise<boolean> {
		const result = await this._client.execute({
			sql: "DELETE FROM memories WHERE id = ?",
			args: [id],
		});
		return Number(result.rowsAffected) > 0;
	}

	async close(): Promise<void> {
		if (this._closed) return;
		this._closed = true;
		try {
			await this._client.close();
		} catch {
			// Ignore close errors.
		}
	}

	private async _touch(entries: MemoryEntry[]): Promise<void> {
		if (entries.length === 0) return;
		const ts = now();
		for (const entry of entries) {
			await this._client.execute({
				sql: "UPDATE memories SET accessed_at = ?, access_count = access_count + 1 WHERE id = ?",
				args: [ts, entry.id],
			});
		}
	}
}
