import { Container, Markdown, type MarkdownTheme } from "@misul/tui";
import { getMarkdownTheme, theme } from "../theme/theme.ts";

const OSC133_ZONE_START = "\x1b]133;A\x07";
const OSC133_ZONE_END = "\x1b]133;B\x07";
const OSC133_ZONE_FINAL = "\x1b]133;C\x07";

/**
 * Renders a user message as plain, boxless text in a muted tone — no big colored
 * fill. The muted colour distinguishes the user's turn from the model's reply
 * (which renders in the default foreground) without a heavy background block.
 */
export class UserMessageComponent extends Container {
	constructor(text: string, markdownTheme: MarkdownTheme = getMarkdownTheme()) {
		super();
		this.addChild(
			new Markdown(
				text,
				1,
				0,
				markdownTheme,
				{ color: (content: string) => theme.fg("muted", content) },
				{ preserveOrderedListMarkers: true },
			),
		);
	}

	override render(width: number): string[] {
		const lines = super.render(width);
		if (lines.length === 0) {
			return lines;
		}

		lines[0] = OSC133_ZONE_START + lines[0];
		lines[lines.length - 1] = OSC133_ZONE_END + OSC133_ZONE_FINAL + lines[lines.length - 1];
		return lines;
	}
}
