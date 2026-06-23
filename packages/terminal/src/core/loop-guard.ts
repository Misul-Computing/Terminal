/**
 * Circuit breaker for runaway tool-call loops.
 *
 * The worst documented cost-blowout in agent harnesses is a model that retries
 * the SAME tool call and gets the SAME result over and over with no progress
 * (e.g. a failing `npm install` run ~300 times, burning tens of millions of
 * tokens). This is especially dangerous for an unattended `/loop`. The guard
 * records a per-turn signature (the turn's tool calls + their results); when the
 * identical signature repeats `threshold` times in a row, the caller aborts.
 *
 * Including the RESULT in the signature is deliberate: legitimate iteration
 * (run tests -> edit -> run tests) produces changing results, so it never trips;
 * only genuine no-progress repetition does.
 */
export interface LoopGuard {
	/** Record a turn signature; returns true once it has repeated `threshold` times consecutively. */
	record(signature: string): boolean;
	/** Reset the streak (e.g. on a new user turn). */
	reset(): void;
}

/**
 * Strip volatile temp-file ids (e.g. `misul-bash-<16 hex>.log`, regenerated every run) from a
 * signature so a truncated-output runaway still hashes identically across turns. Without this
 * the guard would never fire for high-output loops — the exact runaway it exists to catch.
 */
export function stripVolatileIds(signature: string): string {
	return signature.replace(/-[0-9a-f]{16}\.log/g, "-tmp.log");
}

export function createLoopGuard(threshold: number): LoopGuard {
	let lastSignature: string | undefined;
	let count = 0;
	return {
		record(signature: string): boolean {
			if (signature === lastSignature) {
				count += 1;
			} else {
				lastSignature = signature;
				count = 1;
			}
			return count >= threshold;
		},
		reset(): void {
			lastSignature = undefined;
			count = 0;
		},
	};
}
