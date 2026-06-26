import { type Component, visibleWidth } from "@misul/tui";
import { theme } from "../theme/theme.ts";

const DIM_DOT = "·";
const LIT_DOT = "•";
const FRAME_MS = 400;

/**
 * Centered three-dot loader. One dot lights up at a time in a loop.
 * No text. Replaces the spinner + "Working..." loader.
 */
export class DotsLoader implements Component {
	private currentFrame = 0;
	private intervalId: NodeJS.Timeout | null = null;
	private onRender: () => void;

	constructor(onRender: () => void) {
		this.onRender = onRender;
	}

	start(): void {
		this.currentFrame = 0;
		if (this.intervalId) clearInterval(this.intervalId);
		this.intervalId = setInterval(() => {
			this.currentFrame = (this.currentFrame + 1) % 3;
			this.onRender();
		}, FRAME_MS);
		this.onRender();
	}

	stop(): void {
		if (this.intervalId) {
			clearInterval(this.intervalId);
			this.intervalId = null;
		}
	}

	invalidate(): void {}

	render(width: number): string[] {
		const dots = [DIM_DOT, DIM_DOT, DIM_DOT];
		dots[this.currentFrame] = LIT_DOT;
		const line = theme.fg("accent", dots.join(" "));
		const lineWidth = visibleWidth(line);
		const pad = Math.max(0, Math.floor((width - lineWidth) / 2));
		// Leading empty line matches the old Loader's format for visual spacing.
		return ["", " ".repeat(pad) + line];
	}
}
