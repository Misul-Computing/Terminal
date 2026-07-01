import { type Component, type DefaultTextStyle, Markdown, type MarkdownOptions, type MarkdownTheme } from "@misul/tui";

/**
 * Split markdown into top-level blocks separated by blank lines, keeping fenced
 * code (``` / ~~~) whole. During streaming the text is appended, so every block
 * except the last is already final and its text never changes again.
 */
export function splitIntoBlocks(text: string): string[] {
	const lines = text.split("\n");
	const blocks: string[] = [];
	let current: string[] = [];
	let inFence = false;
	for (const line of lines) {
		if (/^\s*(```|~~~)/.test(line)) {
			inFence = !inFence;
			current.push(line);
		} else if (!inFence && line.trim() === "") {
			if (current.length > 0) {
				blocks.push(current.join("\n"));
				current = [];
			}
		} else {
			current.push(line);
		}
	}
	if (current.length > 0) blocks.push(current.join("\n"));
	return blocks;
}

/**
 * Renders markdown incrementally during streaming. Keeps one Markdown per block
 * and only calls setText on a block whose text actually changed, so a re-render
 * after new text arrives re-parses just the final (growing) block while every
 * earlier block is served from its existing Markdown cache. This turns the
 * per-frame cost from O(whole message) into O(changed block).
 *
 * Blocks are re-joined with a single blank line, matching the blank-line
 * separation they were split on.
 */
export class StreamingMarkdown implements Component {
	private readonly blocks: Markdown[] = [];
	private readonly blockTexts: string[] = [];
	private readonly paddingX: number;
	private readonly paddingY: number;
	private readonly theme: MarkdownTheme;
	private readonly defaultTextStyle?: DefaultTextStyle;
	private readonly options?: MarkdownOptions;

	constructor(
		paddingX: number,
		paddingY: number,
		theme: MarkdownTheme,
		defaultTextStyle?: DefaultTextStyle,
		options?: MarkdownOptions,
	) {
		this.paddingX = paddingX;
		this.paddingY = paddingY;
		this.theme = theme;
		this.defaultTextStyle = defaultTextStyle;
		this.options = options;
	}

	setText(text: string): void {
		const next = splitIntoBlocks(text);
		for (let i = 0; i < next.length; i++) {
			if (i < this.blocks.length) {
				// Only re-parse when this block's text changed (the growing tail).
				if (this.blockTexts[i] !== next[i]) {
					this.blocks[i].setText(next[i]);
					this.blockTexts[i] = next[i];
				}
			} else {
				this.blocks.push(
					new Markdown(next[i], this.paddingX, this.paddingY, this.theme, this.defaultTextStyle, this.options),
				);
				this.blockTexts.push(next[i]);
			}
		}
		if (next.length < this.blocks.length) {
			this.blocks.length = next.length;
			this.blockTexts.length = next.length;
		}
	}

	invalidate(): void {
		for (const block of this.blocks) block.invalidate();
	}

	render(width: number): string[] {
		const out: string[] = [];
		for (let i = 0; i < this.blocks.length; i++) {
			if (i > 0) out.push("");
			for (const line of this.blocks[i].render(width)) out.push(line);
		}
		return out;
	}
}
