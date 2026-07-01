import { Container, Markdown, type MarkdownTheme, truncateToWidth, visibleWidth } from "@misul/tui";
import { getMarkdownTheme, theme } from "../theme/theme.ts";

const OSC133_ZONE_START = "\x1b]133;A\x07";
const OSC133_ZONE_END = "\x1b]133;B\x07";
const OSC133_ZONE_FINAL = "\x1b]133;C\x07";

/** Visible width of a rendered line ignoring trailing padding spaces. */
function contentWidth(line: string): number {
	const plain = line.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b\][^\x07]*\x07/g, "");
	return visibleWidth(plain.replace(/\s+$/, ""));
}

/**
 * Renders a user message inside a rounded-border box that hugs the message on
 * both axes: the box is only as wide as the longest line (capped at the column)
 * and as tall as the content. The box is then centered in the available width so
 * a short message reads as a small centered card, clearly distinct from the
 * full-width input box. Uses a muted border so it does not mimic the editor.
 */
export class UserMessageComponent extends Container {
	private readonly markdown: Markdown;

	constructor(text: string, markdownTheme: MarkdownTheme = getMarkdownTheme()) {
		super();
		this.markdown = new Markdown(
			text,
			0,
			0,
			markdownTheme,
			{ color: (content: string) => theme.fg("userMessageText", content) },
			{ preserveOrderedListMarkers: true },
		);
		this.addChild(this.markdown);
	}

	override render(width: number): string[] {
		// Too narrow to frame: fall back to plain content.
		if (width < 8) return this.markdown.render(width);

		const border = (s: string) => theme.fg("borderMuted", s);
		const maxInner = width - 4; // "│ " + content + " │"
		const lines = this.markdown.render(maxInner);
		const rows = lines.length > 0 ? lines : [""];

		// Hug: inner width = widest actual content line (ignoring Markdown's
		// full-width padding), capped at the column.
		const innerWidth = Math.min(maxInner, Math.max(1, ...rows.map(contentWidth)));
		const boxWidth = innerWidth + 4;
		const leftPad = " ".repeat(Math.max(0, Math.floor((width - boxWidth) / 2)));
		const rail = "─".repeat(innerWidth + 2);

		const top = `${leftPad}${border(`╭${rail}╮`)}`;
		const bottom = `${leftPad}${border(`╰${rail}╯`)}`;
		const body = rows.map((line) => {
			const cell = truncateToWidth(line, innerWidth, "");
			const pad = " ".repeat(Math.max(0, innerWidth - visibleWidth(cell)));
			return `${leftPad}${border("│")} ${cell}${pad} ${border("│")}`;
		});

		const result = [top, ...body, bottom];
		// Mark the whole box as one shell-integration zone (markers at column 0).
		result[0] = OSC133_ZONE_START + result[0];
		result[result.length - 1] = OSC133_ZONE_END + OSC133_ZONE_FINAL + result[result.length - 1];
		return result;
	}
}
