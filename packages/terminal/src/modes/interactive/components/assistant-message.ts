import type { AssistantMessage } from "@misul/ai";
import { Container, type DefaultTextStyle, type MarkdownTheme, Spacer, Text } from "@misul/tui";
import { CenteredBlock } from "./centered-block.ts";
import { CollapsibleHeader } from "./collapsible-header.ts";
import { StreamingMarkdown } from "./streaming-markdown.ts";
import { getMarkdownTheme, theme } from "../theme/theme.ts";

const OSC133_ZONE_START = "\x1b]133;A\x07";
const OSC133_ZONE_END = "\x1b]133;B\x07";
const OSC133_ZONE_FINAL = "\x1b]133;C\x07";

// theme.fg reads the current global theme, so this stays correct across theme switches.
const THINKING_STYLE: DefaultTextStyle = {
	color: (text: string) => theme.fg("thinkingText", text),
	italic: true,
};

/**
 * Interface for a single collapsible block within the chat. The cursor
 * navigation logic collects these from all chat children and manages
 * selection/toggling.
 */
export interface CollapsibleItem {
	id: string;
	expanded: boolean;
	setExpanded(expanded: boolean): void;
	setSelected(selected: boolean): void;
}

/**
 * Interface for components that contain collapsible blocks. Both
 * AssistantMessageComponent (thinking blocks) and ToolExecutionComponent
 * (tool calls) implement this so the cursor navigation can collect a flat
 * list of all collapsible blocks in the chat.
 */
export interface CollapsibleContainer {
	getCollapsibleItems(): CollapsibleItem[];
}

function isCollapsibleContainer(child: unknown): child is CollapsibleContainer {
	return (
		typeof child === "object" &&
		child !== null &&
		"getCollapsibleItems" in child &&
		typeof (child as CollapsibleContainer).getCollapsibleItems === "function"
	);
}

export function collectCollapsibleItems(children: unknown[]): CollapsibleItem[] {
	const items: CollapsibleItem[] = [];
	for (const child of children) {
		if (isCollapsibleContainer(child)) {
			items.push(...child.getCollapsibleItems());
		} else if (child && typeof child === "object" && "children" in child && Array.isArray((child as { children: unknown[] }).children)) {
			items.push(...collectCollapsibleItems((child as { children: unknown[] }).children));
		}
	}
	return items;
}

/**
 * Component that renders a complete assistant message.
 *
 * Thinking blocks are rendered as collapsible sections with "− Thinking"
 * (expanded) / "+ Thinking" (collapsed) headers. During streaming, thinking
 * is always expanded. On message_end, thinking blocks auto-collapse.
 */
export class AssistantMessageComponent extends Container implements CollapsibleContainer {
	private contentContainer: Container;
	private hideThinkingBlock: boolean;
	private markdownTheme: MarkdownTheme;
	private lastMessage?: AssistantMessage;
	private hasToolCalls = false;
	private lastBuildSignature?: string;
	private thinkingHeaders: Map<number, CollapsibleHeader> = new Map();
	private thinkingExpanded: Map<number, boolean> = new Map();
	private thinkingSelected: Set<number> = new Set();
	// One incremental markdown renderer per content index, reused across rebuilds
	// so each block's parse cache survives streaming (only the changed block re-parses).
	private streams: Map<number, StreamingMarkdown> = new Map();

	constructor(
		message?: AssistantMessage,
		hideThinkingBlock = false,
		markdownTheme: MarkdownTheme = getMarkdownTheme(),
	) {
		super();

		this.hideThinkingBlock = hideThinkingBlock;
		this.markdownTheme = markdownTheme;

		this.contentContainer = new Container();
		this.addChild(this.contentContainer);

		if (message) {
			this.updateContent(message);
		}
	}

	override invalidate(): void {
		super.invalidate();
		if (this.lastMessage) {
			this.updateContent(this.lastMessage);
		}
	}

	setHideThinkingBlock(hide: boolean): void {
		this.hideThinkingBlock = hide;
		// Update expansion state for all thinking blocks
		for (const [idx] of this.thinkingExpanded) {
			this.thinkingExpanded.set(idx, !hide);
		}
		if (this.lastMessage) {
			this.updateContent(this.lastMessage);
		}
	}

	getCollapsibleItems(): CollapsibleItem[] {
		const items: CollapsibleItem[] = [];
		for (const [idx, header] of this.thinkingHeaders) {
			const id = `thinking-${this.lastMessage?.timestamp ?? 0}-${idx}`;
			items.push({
				id,
				expanded: this.thinkingExpanded.get(idx) ?? false,
				setExpanded: (expanded: boolean) => {
					this.thinkingExpanded.set(idx, expanded);
					// Force rebuild: clear the signature cache so updateContent doesn't skip
					this.lastBuildSignature = undefined;
					if (this.lastMessage) this.updateContent(this.lastMessage);
				},
				setSelected: (selected: boolean) => {
					if (selected) this.thinkingSelected.add(idx);
					else this.thinkingSelected.delete(idx);
					// Force rebuild so the new header picks up the selected state
					this.lastBuildSignature = undefined;
					if (this.lastMessage) this.updateContent(this.lastMessage);
				},
			});
		}
		return items;
	}

	override render(width: number): string[] {
		const lines = super.render(width);
		if (this.hasToolCalls || lines.length === 0) {
			return lines;
		}

		lines[0] = OSC133_ZONE_START + lines[0];
		lines[lines.length - 1] = OSC133_ZONE_END + OSC133_ZONE_FINAL + lines[lines.length - 1];
		return lines;
	}

	private buildSignature(message: AssistantMessage): string {
		const parts = message.content.map((c) =>
			c.type === "text" ? `t${c.text.length}` : c.type === "thinking" ? `k${c.thinking.length}` : c.type,
		);
		const expansionStates = [...this.thinkingExpanded.entries()].map(([k, v]) => `${k}:${v}`).join(",");
		return [
			this.hideThinkingBlock,
			message.stopReason ?? "",
			message.errorMessage ?? "",
			parts.join(","),
			expansionStates,
		].join("|");
	}

	// Reuse one StreamingMarkdown per content index so its per-block parse caches
	// survive the contentContainer.clear() in updateContent; only the changed block
	// re-parses on the next render.
	private getStream(idx: number, text: string, style?: DefaultTextStyle): StreamingMarkdown {
		let stream = this.streams.get(idx);
		if (!stream) {
			stream = new StreamingMarkdown(1, 0, this.markdownTheme, style);
			this.streams.set(idx, stream);
		}
		stream.setText(text);
		return stream;
	}

	updateContent(message: AssistantMessage): void {
		this.lastMessage = message;

		const signature = this.buildSignature(message);
		if (signature === this.lastBuildSignature) return;
		this.lastBuildSignature = signature;

		this.contentContainer.clear();
		this.thinkingHeaders.clear();

		const hasVisibleContent = message.content.some(
			(c) => (c.type === "text" && c.text.trim()) || (c.type === "thinking" && c.thinking.trim()),
		);

		if (hasVisibleContent) {
			this.contentContainer.addChild(new Spacer(1));
		}

		let thinkingIndex = 0;
		for (let i = 0; i < message.content.length; i++) {
			const content = message.content[i];
			if (content.type === "text" && content.text.trim()) {
				const centered = new CenteredBlock(80);
				centered.addChild(this.getStream(i, content.text.trim()));
				this.contentContainer.addChild(centered);
			} else if (content.type === "thinking" && content.thinking.trim()) {
				const idx = thinkingIndex++;
				const isExpanded = this.thinkingExpanded.get(idx) ?? !this.hideThinkingBlock;
				this.thinkingExpanded.set(idx, isExpanded);

				const header = new CollapsibleHeader("Thinking", isExpanded, this.thinkingSelected.has(idx));
				this.thinkingHeaders.set(idx, header);
				this.contentContainer.addChild(header);

				if (isExpanded) {
					const centered = new CenteredBlock(80);
					centered.addChild(this.getStream(i, content.thinking.trim(), THINKING_STYLE));
					this.contentContainer.addChild(centered);
				}

				const hasVisibleContentAfter = message.content
					.slice(i + 1)
					.some((c) => (c.type === "text" && c.text.trim()) || (c.type === "thinking" && c.thinking.trim()));
				if (hasVisibleContentAfter) {
					this.contentContainer.addChild(new Spacer(1));
				}
			}
		}

		const hasToolCalls = message.content.some((c) => c.type === "toolCall");
		this.hasToolCalls = hasToolCalls;
		if (!hasToolCalls) {
			if (message.stopReason === "aborted") {
				const abortMessage =
					message.errorMessage && message.errorMessage !== "Request was aborted"
						? message.errorMessage
						: "Operation aborted";
				this.contentContainer.addChild(new Spacer(1));
				const centered = new CenteredBlock(80);
				centered.addChild(new Text(theme.fg("error", abortMessage), 1, 0));
				this.contentContainer.addChild(centered);
			} else if (message.stopReason === "error") {
				const errorMsg = message.errorMessage || "Unknown error";
				this.contentContainer.addChild(new Spacer(1));
				const centered = new CenteredBlock(80);
				centered.addChild(new Text(theme.fg("error", `Error: ${errorMsg}`), 1, 0));
				this.contentContainer.addChild(centered);
			}
		}
	}
}
