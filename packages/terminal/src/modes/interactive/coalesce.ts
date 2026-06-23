/**
 * Trailing throttle: coalesce rapid calls so the work runs at most once per `ms`.
 *
 * Used for the streaming render: `message_update` fires per token, and re-parsing
 * the whole growing message's markdown on every token is O(n^2). Scheduling the
 * rebuild through this keeps it at ~frame rate instead. The scheduled `fn` reads
 * current state at run time, so the latest message is always rendered; call
 * `cancel()` before a final synchronous render (message_end) so nothing fires late.
 */
export interface Coalescer {
	/** Run `fn` after `ms`; further calls while a run is pending are ignored. */
	schedule(fn: () => void): void;
	/** Cancel a pending run (e.g. before flushing the final state synchronously). */
	cancel(): void;
}

export function createCoalescer(ms: number): Coalescer {
	let timer: ReturnType<typeof setTimeout> | undefined;
	return {
		schedule(fn: () => void): void {
			if (timer) return;
			timer = setTimeout(() => {
				timer = undefined;
				fn();
			}, ms);
		},
		cancel(): void {
			if (timer) {
				clearTimeout(timer);
				timer = undefined;
			}
		},
	};
}
