/**
 * Stream wrapper that recovers when a provider rejects `reasoning_effort`.
 *
 * When a new model ships and the build-time heuristics mis-advertise
 * `reasoning_effort` support, the provider returns a 400. This wrapper detects
 * that, retries the call without `reasoning`, and caches the rejection per model
 * so later calls skip the parameter entirely. New models then work without a
 * manual heuristic update.
 *
 * The cache is in-process and persists across turns within a session.
 * Cross-session persistence can be added later via settings.
 */

import { createAssistantMessageEventStream, type AssistantMessageEventStream } from "@misul/ai";
import type { AssistantMessageEvent, Model } from "@misul/ai";
import type { StreamFn } from "./types.ts";

// In-process rejection cache: modelKey -> true means "this model rejects
// reasoning_effort; strip it before calling the provider".
const rejectionCache = new Map<string, boolean>();

function modelKey(model: Model<any>): string {
	return `${model.provider}/${model.id}`;
}

// Error messages that indicate the provider rejected the reasoning_effort
// parameter (as opposed to an unrelated 400). Matched case-insensitively.
const REASONING_EFFORT_REJECTION = /reasoning_effert|reasoning_effort|unrecognized.*argument.*reasoning/i;

export function isReasoningEffortRejected(errorMessage: string): boolean {
	return REASONING_EFFORT_REJECTION.test(errorMessage);
}

/** Record that a model rejects reasoning_effort, so future calls skip it. */
export function recordReasoningEffortRejection(model: Model<any>): void {
	rejectionCache.set(modelKey(model), true);
}

/** Check whether a model is known to reject reasoning_effort. */
export function rejectsReasoningEffort(model: Model<any>): boolean {
	return rejectionCache.get(modelKey(model)) === true;
}

/**
 * Wrap a stream function with automatic reasoning_effort fallback. When the
 * underlying stream errors with a reasoning_effort rejection on the first event
 * (before any content is emitted), the wrapper retries once without `reasoning`
 * and caches the rejection. Subsequent calls to the same model strip `reasoning`
 * up-front, avoiding the wasted round-trip.
 */
export function createResilientStreamFn(baseStreamFn: StreamFn): StreamFn {
	return async (model, context, options) => {
		// Fast path: if we already know this model rejects reasoning_effort, strip it.
		if (options?.reasoning && rejectsReasoningEffort(model)) {
			const { reasoning: _reasoning, ...rest } = options;
			return baseStreamFn(model, context, rest);
		}

		const underlying = await baseStreamFn(model, context, options);
		if (!options?.reasoning) return underlying;

		// Wrap: peek at events. If the first event is a reasoning_effort rejection
		// error, retry without reasoning. Otherwise forward everything verbatim.
		const wrapper = createAssistantMessageEventStream();
		const iterator = underlying[Symbol.asyncIterator]();
		const firstEvent = await iterator.next();

		const isErrorRejection =
			!firstEvent.done &&
			firstEvent.value.type === "error" &&
			isReasoningEffortRejected(
				(firstEvent.value as { error?: { errorMessage?: string } }).error?.errorMessage ?? "",
			);

		if (isErrorRejection) {
			// Cache and retry without reasoning.
			recordReasoningEffortRejection(model);
			const { reasoning: _reasoning, ...rest } = options;
			const retry = await baseStreamFn(model, context, rest);
			// Forward all events from the retry stream into the wrapper.
			void forwardStream(retry, wrapper);
			return wrapper;
		}

		// Not a rejection: forward the first event and the rest.
		if (!firstEvent.done) {
			wrapper.push(firstEvent.value as AssistantMessageEvent);
			if (firstEvent.value.type === "done" || firstEvent.value.type === "error") {
				wrapper.end();
				return wrapper;
			}
		} else {
			wrapper.end();
			return wrapper;
		}

		void forwardIterator(iterator, wrapper);
		return wrapper;
	};
}

function forwardStream(
	source: AssistantMessageEventStream,
	target: AssistantMessageEventStream,
): Promise<void> {
	return forwardIterator(source[Symbol.asyncIterator](), target);
}

async function forwardIterator(
	iterator: AsyncIterator<AssistantMessageEvent>,
	target: AssistantMessageEventStream,
): Promise<void> {
	try {
		while (true) {
			const result = await iterator.next();
			if (result.done) {
				target.end();
				return;
			}
			target.push(result.value);
			if (result.value.type === "done" || result.value.type === "error") {
				target.end();
				return;
			}
		}
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		target.push({
			type: "error",
			reason: "error",
			error: { errorMessage } as any,
		} as AssistantMessageEvent);
		target.end();
	}
}
