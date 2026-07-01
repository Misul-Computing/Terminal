import { Container, visibleWidth } from "@misul/tui";

// A single leading ANSI escape (CSI / OSC / etc.) so left padding is inserted
// AFTER stream markers like OSC 133, keeping those at column 0.
const LEADING_ANSI = /^(\x1b\[[0-9;]*[A-Za-z]|\x1b\][^\x07]*\x07|\x1b[()][0AB]|\x1b[=>N])/;

function padAfterLeadingAnsi(line: string, pad: string): string {
	let i = 0;
	while (i < line.length) {
		const m = line.slice(i).match(LEADING_ANSI);
		if (!m) break;
		i += m[0].length;
	}
	return i === 0 ? pad + line : line.slice(0, i) + pad + line.slice(i);
}

/**
 * Centers its children as a single block. Renders at min(width, maxWidth) so text
 * still wraps within the reading column, measures the widest line (ignoring the
 * trailing padding Markdown/Text add), then left-pads every line by the same
 * amount so the block sits centered while the text stays left-aligned inside it.
 * A short reply is centered; content that fills the column is left where it was.
 *
 * Unlike CenteredContainer (which centers the fixed-width column regardless of
 * content), this centers by the actual content width.
 */
export class CenteredBlock extends Container {
	private readonly maxWidth: number;

	constructor(maxWidth: number) {
		super();
		this.maxWidth = maxWidth;
	}

	override render(width: number): string[] {
		const contentWidth = Math.min(width, this.maxWidth);
		const lines = super.render(contentWidth).map((l) => (l.length === 0 ? l : l.replace(/\s+$/, "")));

		let blockWidth = 0;
		for (const l of lines) {
			const w = visibleWidth(l);
			if (w > blockWidth) blockWidth = w;
		}

		const leftPad = Math.max(0, Math.floor((width - blockWidth) / 2));
		if (leftPad === 0) return lines;
		const pad = " ".repeat(leftPad);
		return lines.map((l) => (l.length === 0 ? l : padAfterLeadingAnsi(l, pad)));
	}
}
