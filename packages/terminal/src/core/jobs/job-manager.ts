/**
 * JobManager - Background job manager with owner scoping.
 *
 * Jobs are async functions that run to completion, report progress, and
 * return a result. Each job is scoped to an owner (session ID or subagent
 * ID); jobs can only be queried or cancelled by their owner.
 */

export type JobStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export interface Job {
	id: string;
	owner: string;
	name: string;
	status: JobStatus;
	progress?: number; // 0-1
	result?: unknown;
	error?: string;
	startedAt: number;
	completedAt?: number;
}

export interface JobOptions {
	owner: string;
	name: string;
	timeoutMs?: number;
}

/** Progress callback passed to a job function. */
export type JobProgress = (progress: number) => void;

/** Context passed to a job function. */
export interface JobContext {
	/** Signal aborted when the job is cancelled or times out. */
	signal: AbortSignal;
	/** Report progress between 0 and 1. */
	progress: JobProgress;
}

/** Function executed as a background job. */
export type JobFn<T = unknown> = (ctx: JobContext) => Promise<T>;

interface JobEntry<T = unknown> {
	job: Job;
	abortController: AbortController;
	promise: Promise<T>;
	timeoutTimer?: ReturnType<typeof setTimeout>;
	done: boolean;
}

export class JobManager {
	private _jobs = new Map<string, JobEntry>();

	/** Start a background job. Returns the job ID. */
	spawn<T>(opts: JobOptions, fn: JobFn<T>): string {
		const id = crypto.randomUUID();
		const abortController = new AbortController();
		const job: Job = {
			id,
			owner: opts.owner,
			name: opts.name,
			status: "pending",
			startedAt: Date.now(),
		};

		const ctx: JobContext = {
			signal: abortController.signal,
			progress: (p: number) => {
				const entry = this._jobs.get(id);
				if (!entry) return;
				entry.job.progress = Math.max(0, Math.min(1, p));
			},
		};

		let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
		if (opts.timeoutMs && opts.timeoutMs > 0) {
			timeoutTimer = setTimeout(() => {
				abortController.abort(new Error(`Job "${opts.name}" timed out after ${opts.timeoutMs}ms`));
			}, opts.timeoutMs);
		}

		const promise = this._run(id, fn, ctx);

		const entry: JobEntry<T> = {
			job,
			abortController,
			promise,
			timeoutTimer,
			done: false,
		};
		this._jobs.set(id, entry as JobEntry);

		return id;
	}

	private async _run<T>(id: string, fn: JobFn<T>, ctx: JobContext): Promise<T> {
		const entry = this._jobs.get(id);
		if (!entry) throw new Error(`Job ${id} not found`);
		entry.job.status = "running";

		try {
			const result = await fn(ctx);
			if (entry.timeoutTimer) clearTimeout(entry.timeoutTimer);
			entry.job.status = "completed";
			entry.job.progress = 1;
			entry.job.result = result;
			entry.job.completedAt = Date.now();
			entry.done = true;
			return result;
		} catch (err) {
			if (entry.timeoutTimer) clearTimeout(entry.timeoutTimer);
			entry.job.completedAt = Date.now();
			entry.done = true;
			if (ctx.signal.aborted) {
				entry.job.status = "cancelled";
				entry.job.error = err instanceof Error ? err.message : String(err);
			} else {
				entry.job.status = "failed";
				entry.job.error = err instanceof Error ? err.message : String(err);
			}
			throw err;
		}
	}

	/** Get a job's status. Returns undefined if not found or owner mismatch. */
	get(jobId: string, owner: string): Job | undefined {
		const entry = this._jobs.get(jobId);
		if (!entry) return undefined;
		if (entry.job.owner !== owner) return undefined;
		return { ...entry.job };
	}

	/** List all jobs for an owner. */
	list(owner: string): Job[] {
		const out: Job[] = [];
		for (const entry of this._jobs.values()) {
			if (entry.job.owner === owner) out.push({ ...entry.job });
		}
		return out;
	}

	/** Cancel a running job. Returns true if cancelled, false if not found/owner mismatch/already done. */
	cancel(jobId: string, owner: string): boolean {
		const entry = this._jobs.get(jobId);
		if (!entry) return false;
		if (entry.job.owner !== owner) return false;
		if (entry.done) return false;
		if (entry.job.status === "cancelled") return false;
		entry.abortController.abort(new Error(`Job "${entry.job.name}" cancelled by owner`));
		return true;
	}

	/** Wait for a job to complete (any terminal status). Resolves with the job snapshot. */
	async waitFor(jobId: string, owner: string): Promise<Job | undefined> {
		const entry = this._jobs.get(jobId);
		if (!entry) return undefined;
		if (entry.job.owner !== owner) return undefined;
		try {
			await entry.promise;
		} catch {
			// Status already recorded; swallow.
		}
		return this.get(jobId, owner);
	}

	/** Cancel all running jobs. */
	dispose(): void {
		for (const entry of this._jobs.values()) {
			if (entry.timeoutTimer) clearTimeout(entry.timeoutTimer);
			if (!entry.done && entry.job.status !== "cancelled") {
				entry.abortController.abort(new Error(`Job "${entry.job.name}" cancelled on dispose`));
			}
		}
		this._jobs.clear();
	}
}
