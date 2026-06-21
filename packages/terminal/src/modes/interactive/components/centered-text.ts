import { type Component, visibleWidth } from "@misul/tui";

/**
 * Renders text centered horizontally within the available width. Each line is
 * padded by half the remaining space, measured ignoring ANSI escape codes, so
 * coloured text centers correctly. Lines wider than the width are left as-is.
 */
export class CenteredText implements Component {
	private readonly getText: () => string;

	constructor(getText: () => string) {
		this.getText = getText;
	}

	invalidate(): void {}

	render(width: number): string[] {
		return this.getText()
			.split("\n")
			.map((line) => {
				const pad = Math.max(0, Math.floor((width - visibleWidth(line)) / 2));
				return pad > 0 ? " ".repeat(pad) + line : line;
			});
	}
}
