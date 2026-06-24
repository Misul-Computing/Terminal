import { Container } from "@misul/tui";

// Matches a single leading ANSI escape sequence: CSI (...m etc.), OSC (...BEL),
// or a single-char ESC sequence. Used so centering padding is inserted AFTER any
// leading escape codes (e.g. the OSC 133 zone markers AssistantMessageComponent
// emits), keeping those markers at column 0 where the terminal expects them.
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
 * Container that renders its children at a reduced content width
 * (min(width, maxWidth)) and left-pads every rendered line by a uniform margin so
 * the whole content block sits centered horizontally. Gives the chat a readable
 * centered column on wide terminals instead of spanning the full width.
 *
 * Padding is inserted after leading ANSI escape sequences so OSC 133 zone markers
 * (and other stream-level controls) remain at column 0.
 */
export class CenteredContainer extends Container {
	private readonly maxWidth: number;

	constructor(maxWidth: number) {
		super();
		this.maxWidth = maxWidth;
	}

	override render(width: number): string[] {
		const contentWidth = Math.min(width, this.maxWidth);
		const raw = super.render(contentWidth);
		const leftPad = Math.max(0, Math.floor((width - contentWidth) / 2));
		if (leftPad === 0) {
			return raw;
		}
		const pad = " ".repeat(leftPad);
		return raw.map((line) => (line.length === 0 ? line : padAfterLeadingAnsi(line, pad)));
	}
}
