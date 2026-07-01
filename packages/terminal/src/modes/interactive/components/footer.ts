import { isAbsolute, relative, resolve, sep } from "node:path";
import { type Component, truncateToWidth, visibleWidth } from "@misul/tui";
import type { AgentSession } from "../../../core/agent-session.ts";
import { areExperimentalFeaturesEnabled } from "../../../core/experimental.ts";
import type { ContextUsage } from "../../../core/extensions/types.ts";
import type { ReadonlyFooterDataProvider } from "../../../core/footer-data-provider.ts";
import { theme } from "../theme/theme.ts";

/**
 * Sanitize text for display in a single-line status.
 * Removes newlines, tabs, carriage returns, and other control characters.
 */
function sanitizeStatusText(text: string): string {
	// Replace newlines, tabs, carriage returns with space, then collapse multiple spaces
	return text
		.replace(/[\r\n\t]/g, " ")
		.replace(/ +/g, " ")
		.trim();
}

/**
 * Format token counts for compact footer display.
 */
function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
	return `${Math.round(count / 1000000)}M`;
}

export function formatCwdForFooter(cwd: string, home: string | undefined): string {
	if (!home) return cwd;

	const resolvedCwd = resolve(cwd);
	const resolvedHome = resolve(home);
	const relativeToHome = relative(resolvedHome, resolvedCwd);
	const isInsideHome =
		relativeToHome === "" ||
		(relativeToHome !== ".." && !relativeToHome.startsWith(`..${sep}`) && !isAbsolute(relativeToHome));

	if (!isInsideHome) return cwd;
	return relativeToHome === "" ? "~" : `~/${relativeToHome.split(sep).join("/")}`;
}

/**
 * Footer component that shows pwd, token stats, and context usage.
 * Computes token/context stats from session, gets git branch and extension statuses from provider.
 *
 * Token stats are cached and only recomputed when the session entry count changes,
 * avoiding a full iteration of all session entries on every render frame.
 */
export class FooterComponent implements Component {
	private autoCompactEnabled = true;
	private session: AgentSession;
	private footerData: ReadonlyFooterDataProvider;

	// Cached token stats — recomputed only when entry count changes
	private cachedEntryCount = -1;
	private cachedStats: {
		totalInput: number;
		totalOutput: number;
		totalCacheRead: number;
		totalCacheWrite: number;
		totalCost: number;
		latestCacheHitRate: number | undefined;
		tokensPerSec: number | undefined;
	} | undefined;

	// Cached context usage — recomputed only when entry count changes.
	// getContextUsage() walks the branch + estimates tokens from all messages,
	// so caching it avoids O(n) work on every render frame.
	private cachedContextUsage: ContextUsage | undefined;
	private cachedContextUsageEntryCount = -1;

	constructor(session: AgentSession, footerData: ReadonlyFooterDataProvider) {
		this.session = session;
		this.footerData = footerData;
	}

	setSession(session: AgentSession): void {
		this.session = session;
		this.cachedEntryCount = -1;
		this.cachedStats = undefined;
		this.cachedContextUsage = undefined;
		this.cachedContextUsageEntryCount = -1;
	}

	setAutoCompactEnabled(enabled: boolean): void {
		this.autoCompactEnabled = enabled;
	}

	/**
	 * Invalidates cached stats. Called when session state changes.
	 */
	invalidate(): void {
		this.cachedEntryCount = -1;
		this.cachedStats = undefined;
		this.cachedContextUsage = undefined;
		this.cachedContextUsageEntryCount = -1;
	}

	/**
	 * Clean up resources.
	 * Git watcher cleanup now handled by provider.
	 */
	dispose(): void {
		// Git watcher cleanup handled by provider
	}

	private computeStats(): {
		totalInput: number;
		totalOutput: number;
		totalCacheRead: number;
		totalCacheWrite: number;
		totalCost: number;
		latestCacheHitRate: number | undefined;
		tokensPerSec: number | undefined;
	} {
		const entries = this.session.sessionManager.getEntries();
		const entryCount = entries.length;

		// Return cache if entry count hasn't changed
		if (this.cachedStats && this.cachedEntryCount === entryCount) {
			return this.cachedStats;
		}

		let totalInput = 0;
		let totalOutput = 0;
		let totalCacheRead = 0;
		let totalCacheWrite = 0;
		let totalCost = 0;
		let latestCacheHitRate: number | undefined;
		let tokensPerSec: number | undefined;

		// Only collect what we need — avoid creating intermediate arrays
		let prevAssistant: { usage: any; timestamp: number } | undefined;
		let lastAssistant: { usage: any; timestamp: number } | undefined;

		for (const entry of entries) {
			if (entry.type === "message" && entry.message.role === "assistant") {
				const msg = entry.message;
				totalInput += msg.usage.input;
				totalOutput += msg.usage.output;
				totalCacheRead += msg.usage.cacheRead;
				totalCacheWrite += msg.usage.cacheWrite;
				totalCost += msg.usage.cost.total;

				const latestPromptTokens =
					msg.usage.input + msg.usage.cacheRead + msg.usage.cacheWrite;
				latestCacheHitRate =
					latestPromptTokens > 0 ? (msg.usage.cacheRead / latestPromptTokens) * 100 : undefined;

				prevAssistant = lastAssistant;
				lastAssistant = { usage: msg.usage, timestamp: msg.timestamp };
			}
		}

		// Calculate tokens/sec from the last two assistant messages
		if (prevAssistant && lastAssistant) {
			const timeDeltaMs = lastAssistant.timestamp - prevAssistant.timestamp;
			if (timeDeltaMs > 0) {
				tokensPerSec = (lastAssistant.usage.output / timeDeltaMs) * 1000;
			}
		}

		const stats = {
			totalInput,
			totalOutput,
			totalCacheRead,
			totalCacheWrite,
			totalCost,
			latestCacheHitRate,
			tokensPerSec,
		};
		this.cachedEntryCount = entryCount;
		this.cachedStats = stats;
		return stats;
	}

	render(width: number): string[] {
		const state = this.session.state;

		const stats = this.computeStats();
		const {
			totalInput,
			totalOutput,
			totalCacheRead,
			totalCacheWrite,
			totalCost,
			latestCacheHitRate,
			tokensPerSec,
		} = stats;

		// Calculate context usage from session (handles compaction correctly).
		// After compaction, tokens are unknown until the next LLM response.
		// Cached by entry count — getContextUsage() walks the branch and
		// estimates tokens from all messages, so we avoid O(n) work per frame.
		const entryCount = this.cachedEntryCount; // already updated by computeStats()
		if (this.cachedContextUsageEntryCount !== entryCount) {
			this.cachedContextUsage = this.session.getContextUsage();
			this.cachedContextUsageEntryCount = entryCount;
		}
		const contextUsage = this.cachedContextUsage;
		const contextWindow = contextUsage?.contextWindow ?? state.model?.contextWindow ?? 0;
		const contextPercentValue = contextUsage?.percent ?? 0;
		const contextPercent = contextUsage?.percent !== null ? contextPercentValue.toFixed(1) : "?";

		// Replace home directory with ~
		let pwd = formatCwdForFooter(this.session.sessionManager.getCwd(), process.env.HOME || process.env.USERPROFILE);

		// Add git branch if available
		const branch = this.footerData.getGitBranch();
		if (branch) {
			pwd = `${pwd} (${branch})`;
		}

		// Add session name if set
		const sessionName = this.session.sessionManager.getSessionName();
		if (sessionName) {
			pwd = `${pwd} • ${sessionName}`;
		}

		// Build stats line: context gauge first (leftmost), then t/s and price.
		const statsParts = [];

		// Compact context-usage gauge + percentage, colorized by usage severity.
		let contextPercentStr: string;
		const autoIndicator = this.autoCompactEnabled ? " (auto)" : "";
		const gaugeWidth = 5;
		const filledSegments =
			contextPercent === "?"
				? 0
				: Math.max(0, Math.min(gaugeWidth, Math.round((contextPercentValue / 100) * gaugeWidth)));
		// Thin-line gauge: heavy rule for filled, light rule for the empty track.
		const gauge = `${"━".repeat(filledSegments)}${"─".repeat(gaugeWidth - filledSegments)}`;
		const contextPercentDisplay =
			contextPercent === "?"
				? `${gauge} ?/${formatTokens(contextWindow)}${autoIndicator}`
				: `${gauge} ${contextPercent}%/${formatTokens(contextWindow)}${autoIndicator}`;
		if (contextPercentValue > 90) {
			contextPercentStr = theme.fg("error", contextPercentDisplay);
		} else if (contextPercentValue > 70) {
			contextPercentStr = theme.fg("warning", contextPercentDisplay);
		} else {
			contextPercentStr = theme.fg("accent", contextPercentDisplay);
		}
		statsParts.push(contextPercentStr);

		if (latestCacheHitRate !== undefined && latestCacheHitRate > 0) {
			// Color the hit rate: warning below 70% (design doc target), muted otherwise.
			const hitColor = latestCacheHitRate < 70 ? "warning" : "muted";
			const cacheLabel = `cache ${latestCacheHitRate.toFixed(0)}%`;
			// Append absolute read/write counts when there is room (compact format).
			if (totalCacheRead > 0 || totalCacheWrite > 0) {
				statsParts.push(
					`${theme.fg(hitColor, cacheLabel)} ${theme.fg("dim", `r${formatTokens(totalCacheRead)} w${formatTokens(totalCacheWrite)}`)}`,
				);
			} else {
				statsParts.push(theme.fg(hitColor, cacheLabel));
			}
		}

		if (tokensPerSec !== undefined && tokensPerSec > 0) {
			statsParts.push(theme.fg("muted", `${tokensPerSec.toFixed(1)} t/s`));
		}

		// Show cost with "(sub)" indicator if using OAuth subscription
		const usingSubscription = state.model ? this.session.modelRegistry.isUsingOAuth(state.model) : false;
		if (totalCost || usingSubscription) {
			const costStr = `$${totalCost.toFixed(3)}${usingSubscription ? " (sub)" : ""}`;
			statsParts.push(theme.fg("muted", costStr));
		}
		if (areExperimentalFeaturesEnabled()) {
			statsParts.push(`${theme.fg("dim", "•")} ${theme.bold(theme.fg("warning", "xp"))}`);
		}

		// Show permission mode when not "ask" (the default)
		const permMode = this.session.permissionMode;
		if (permMode === "auto") {
			statsParts.push(`${theme.fg("dim", "•")} ${theme.fg("warning", "auto")}`);
		} else if (permMode === "plan") {
			statsParts.push(`${theme.fg("dim", "•")} ${theme.fg("accent", "plan")}`);
		}

		let statsLeft = statsParts.join(" ");

		// Add model name on the right side.
		const modelName = state.model?.name || state.model?.id || "no-model";

		let statsLeftWidth = visibleWidth(statsLeft);

		// If statsLeft is too wide, truncate it
		if (statsLeftWidth > width) {
			statsLeft = truncateToWidth(statsLeft, width, "...");
			statsLeftWidth = visibleWidth(statsLeft);
		}

		// Calculate available space for padding (minimum 2 spaces between stats and model)
		const minPadding = 2;

		// Prepend the provider in parentheses if there are multiple providers and there's enough room
		let rightSide = modelName;
		if (this.footerData.getAvailableProviderCount() > 1 && state.model) {
			rightSide = `(${state.model!.provider}) ${modelName}`;
			if (statsLeftWidth + minPadding + visibleWidth(rightSide) > width) {
				// Too wide, fall back
				rightSide = modelName;
			}
		}

		const rightSideWidth = visibleWidth(rightSide);
		const totalNeeded = statsLeftWidth + minPadding + rightSideWidth;

		let statsLine: string;
		if (totalNeeded <= width) {
			// Both fit - add padding to right-align model
			const padding = " ".repeat(width - statsLeftWidth - rightSideWidth);
			statsLine = statsLeft + padding + rightSide;
		} else {
			// Need to truncate right side
			const availableForRight = width - statsLeftWidth - minPadding;
			if (availableForRight > 0) {
				const truncatedRight = truncateToWidth(rightSide, availableForRight, "…");
				const truncatedRightWidth = visibleWidth(truncatedRight);
				const padding = " ".repeat(Math.max(0, width - statsLeftWidth - truncatedRightWidth));
				statsLine = statsLeft + padding + truncatedRight;
			} else {
				// Not enough space for right side at all
				statsLine = statsLeft;
			}
		}

		// Apply dim to each part separately. statsLeft may contain color codes (for context %)
		// that end with a reset, which would clear an outer dim wrapper. So we dim the parts
		// before and after the colored section independently.
		const dimStatsLeft = theme.fg("dim", statsLeft);
		const remainder = statsLine.slice(statsLeft.length); // padding + rightSide
		const dimRemainder = theme.fg("dim", remainder);

		const pwdLine = truncateToWidth(theme.fg("dim", pwd), width, theme.fg("dim", "..."));
		const lines = [pwdLine, dimStatsLeft + dimRemainder];

		// Add extension statuses on a single line, sorted by key alphabetically
		const extensionStatuses = this.footerData.getExtensionStatuses();
		if (extensionStatuses.size > 0) {
			const sortedStatuses = Array.from(extensionStatuses.entries())
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([, text]) => sanitizeStatusText(text));
			const statusLine = sortedStatuses.join(" ");
			// Truncate to terminal width with dim ellipsis for consistency with footer style
			lines.push(truncateToWidth(statusLine, width, theme.fg("dim", "...")));
		}

		return lines;
	}
}
