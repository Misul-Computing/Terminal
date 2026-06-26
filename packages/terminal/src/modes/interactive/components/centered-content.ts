import { Container, visibleWidth } from "@misul/tui";

// Matches a single leading ANSI escape sequence so centering padding is inserted
// AFTER any leading escape codes (e.g. OSC 133 zone markers), keeping those
// markers at column 0 where the terminal expects them.
const LEADING_ANSI = /^(\x1b\[[0-9;]*[A-Za-z]|\x1b\][^\x07]*\x07|\x1b[()][0AB]|\x1b[=>N])/;

function padAfterLeadingAnsi(line: string, pad: string): string {
	let i = 0;
	let m: RegExpMatchArray | null;
	while (i < line.length && (m = line.slice(i).match(LEADING_ANSI))) {
		i += m[0].length;
	}
	return i === 0 ? pad + line : line.slice(0, i) + pad + line.slice(i);
}

/**
 * Strip trailing whitespace and trailing ANSI reset codes from a rendered line
 * so the visible content width can be measured for centering. Markdown and Text
 * components pad lines to the full width with spaces, which would make every
 * line appear "full-width" and prevent centering.
 */
function stripTrailingPadding(line: string): string {
	// Remove trailing spaces (the padding added by Markdown/Text)
	let trimmed = line.replace(/\s+$/, "");
	// Also remove trailing ANSI reset codes that might be after the padding
	trimmed = trimmed.replace(/\x1b\[0m$/, "");
	return trimmed;
}

/**
 * Container that center-aligns each rendered line of its children within the
 * available width. Unlike CenteredContainer (which centers the *block* on the
 * terminal by left-padding uniformly), this centers the *text content* of each
 * line individually so paragraphs and thinking traces appear visually centered.
 *
 * Trailing padding (added by Markdown/Text to fill the width) is stripped
 * before measuring so the actual content width is used for centering.
 * Lines that are wider than the available width are left as-is.
 * Empty lines are passed through unchanged.
 */
export class CenteredContent extends Container {
	override render(width: number): string[] {
		const raw = super.render(width);
		return raw.map((line) => {
			if (line.length === 0) return line;
			// Strip trailing padding to measure actual content width
			const stripped = stripTrailingPadding(line);
			const vw = visibleWidth(stripped);
			if (vw >= width) return line;
			const pad = Math.floor((width - vw) / 2);
			if (pad === 0) return line;
			return padAfterLeadingAnsi(stripped, " ".repeat(pad));
		});
	}
}
