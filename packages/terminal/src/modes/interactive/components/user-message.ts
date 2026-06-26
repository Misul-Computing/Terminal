import { Container, Markdown, type MarkdownTheme } from "@misul/tui";
import { CenteredContainer } from "./centered-container.ts";
import { getMarkdownTheme, theme } from "../theme/theme.ts";

const OSC133_ZONE_START = "\x1b]133;A\x07";
const OSC133_ZONE_END = "\x1b]133;B\x07";
const OSC133_ZONE_FINAL = "\x1b]133;C\x07";

/**
 * Renders a user message with a subtle background color to distinguish it
 * from assistant responses. The background extends 1 space beyond the
 * message content on each side horizontally, and 1 blank line above and
 * below vertically.
 */
export class UserMessageComponent extends Container {
	constructor(text: string, markdownTheme: MarkdownTheme = getMarkdownTheme()) {
		super();
		const centered = new CenteredContainer(80);
		centered.addChild(
			new Markdown(
				text,
				1,
				0,
				markdownTheme,
				{ color: (content: string) => theme.fg("userMessageText", content) },
				{ preserveOrderedListMarkers: true },
			),
		);
		this.addChild(centered);
	}

	override render(width: number): string[] {
		const lines = super.render(width);
		if (lines.length === 0) {
			return lines;
		}

		// Apply background with 1-space padding on each side of the content.
		const bgFn = (text: string) => theme.bg("userMessageBg", text);

		// First pass: extract content and leading pad for each line.
		const parts = lines.map((line) => {
			if (line.length === 0) return null;
			const trimmed = line.replace(/\s+$/, "");
			if (trimmed.length === 0) return null;
			const leadingPad = trimmed.match(/^\s*/)?.[0] ?? "";
			const content = trimmed.slice(leadingPad.length);
			if (content.length === 0) return null;
			return { leadingPad, content };
		});

		// Build bg lines: 1 space left + content + 1 space right.
		const result = lines.map((line, i) => {
			const p = parts[i];
			if (!p) return line;
			return p.leadingPad + bgFn(" " + p.content + " ");
		});

		// OSC markers go on the first and last non-empty content lines.
		let firstContentIdx = -1;
		let lastContentIdx = -1;
		for (let i = 0; i < result.length; i++) {
			if (parts[i] !== null) {
				if (firstContentIdx === -1) firstContentIdx = i;
				lastContentIdx = i;
			}
		}
		if (firstContentIdx >= 0) {
			result[firstContentIdx] = OSC133_ZONE_START + result[firstContentIdx];
		}
		if (lastContentIdx >= 0) {
			result[lastContentIdx] = OSC133_ZONE_END + OSC133_ZONE_FINAL + result[lastContentIdx];
		}
		return result;
	}
}
