/**
 * Thin adapter between pi-ai `AssistantMessage` cost fields and the cherry-picked
 * {@link AgentRunCollector}. The collector is provider-agnostic and expects the
 * caller to extract `{ costUsd, costUnavailableReason }`; this module is the only
 * place that knows pi-ai's `usage.cost.total` shape.
 */

import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { Span } from "@opentelemetry/api";
import type { AgentRunCollector } from "./run-collector.ts";

export interface CostFields {
	costUsd: number | undefined;
	costUnavailableReason: string | undefined;
}

/** Pull the provider-authoritative dollar cost off a finalized assistant message. */
export function costFieldsFromMessage(message: AssistantMessage): CostFields {
	const total = message.usage?.cost?.total;
	if (typeof total !== "number") {
		return { costUsd: undefined, costUnavailableReason: "missing usage.cost.total" };
	}
	return { costUsd: total, costUnavailableReason: undefined };
}

/** Record a finalized chat step on the collector with cost extracted from the message. */
export function recordChat(collector: AgentRunCollector, span: Span, message: AssistantMessage): void {
	collector.endChat(span, message, costFieldsFromMessage(message));
}
