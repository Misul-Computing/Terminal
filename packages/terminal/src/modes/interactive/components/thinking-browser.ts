import { Container, getKeybindings, truncateToWidth, wrapTextWithAnsi } from "@misul/tui";
import { theme } from "../theme/theme.ts";
import { DynamicBorder } from "./dynamic-border.ts";

export interface ThinkingBrowserEntry {
	/** Display label for the source, e.g. the assistant message model id. */
	model: string;
	/** The raw thinking text (plain text, no ANSI). */
	thinking: string;
}

/**
 * Cursor-driven browser for the thinking traces in the current session.
 *
 * Lists every thinking block as a collapsible entry. Move the cursor with the
 * select up/down keys, press enter to expand or collapse the selected trace
 * (the wrapped text is shown inline beneath its header), and escape / ctrl+c to
 * close. This gives per-block open/close driven by the cursor, instead of the
 * all-or-nothing global thinking toggle.
 *
 * The component is self-contained: it renders a windowed view (so a long session
 * stays navigable) and handles its own input via the focused-component contract.
 */
export class ThinkingBrowserComponent extends Container {
	private readonly entries: ThinkingBrowserEntry[];
	private selectedIndex = 0;
	private topIndex = 0;
	private readonly expanded: Set<number> = new Set();
	private readonly maxVisibleLines: number;
	private readonly maxExpandedLines: number;

	public onCancel?: () => void;

	constructor(entries: ThinkingBrowserEntry[], maxVisibleLines = 18, maxExpandedLines = 12) {
		super();
		this.entries = entries;
		this.maxVisibleLines = maxVisibleLines;
		this.maxExpandedLines = maxExpandedLines;
	}

	invalidate(): void {
		// No cached render state.
	}

	handleInput(data: string): void {
		const kb = getKeybindings();
		if (kb.matches(data, "tui.select.up")) {
			this.selectedIndex = this.selectedIndex === 0 ? this.entries.length - 1 : this.selectedIndex - 1;
		} else if (kb.matches(data, "tui.select.down")) {
			this.selectedIndex = this.selectedIndex === this.entries.length - 1 ? 0 : this.selectedIndex + 1;
		} else if (kb.matches(data, "tui.select.confirm")) {
			if (this.expanded.has(this.selectedIndex)) {
				this.expanded.delete(this.selectedIndex);
			} else {
				this.expanded.add(this.selectedIndex);
			}
		} else if (kb.matches(data, "tui.select.cancel")) {
			this.onCancel?.();
		}
	}

	override render(width: number): string[] {
		const lines: string[] = [];
		lines.push(new DynamicBorder().render(width)[0]);

		if (this.entries.length === 0) {
			lines.push(theme.fg("muted", "  No thinking traces in this session yet."));
			lines.push(new DynamicBorder().render(width)[0]);
			return lines;
		}

		lines.push(theme.bold(theme.fg("accent", "  Thinking traces")));
		lines.push(theme.fg("dim", "  cursor to move · enter to expand/collapse · esc to close"));
		lines.push("");

		// Keep the cursor inside the window.
		if (this.selectedIndex < this.topIndex) {
			this.topIndex = this.selectedIndex;
		}

		const rendered = this.renderWindow(width);
		lines.push(...rendered.lines);

		// If the selected entry fell outside the window (cursor moved below it),
		// re-anchor the window to the selection and render once more.
		if (!rendered.selectedVisible) {
			this.topIndex = this.selectedIndex;
			const retry = this.renderWindow(width);
			// Replace the body lines (keep header/border already pushed).
			const bodyStart = lines.length - rendered.lines.length;
			lines.splice(bodyStart, rendered.lines.length, ...retry.lines);
		}

		const scrollInfo = theme.fg("muted", `  (${this.selectedIndex + 1}/${this.entries.length})`);
		lines.push(scrollInfo);
		lines.push(new DynamicBorder().render(width)[0]);
		return lines;
	}

	private renderWindow(width: number): { lines: string[]; selectedVisible: boolean } {
		const out: string[] = [];
		let shown = 0;
		let i = this.topIndex;
		let selectedVisible = false;
		const bodyWidth = Math.max(10, width - 6);

		while (i < this.entries.length && shown < this.maxVisibleLines) {
			const entry = this.entries[i];
			const isSel = i === this.selectedIndex;
			const isOpen = this.expanded.has(i);
			const marker = isOpen ? "▼" : "▶";
			const lineCount = entry.thinking.split("\n").length;
			const header = `${isSel ? "→ " : "  "}${marker} #${i + 1} · ${entry.model} · ${lineCount} lines`;
			out.push(isSel ? theme.fg("accent", truncateToWidth(header, width - 1, "")) : theme.fg("muted", truncateToWidth(header, width - 1, "")));
			shown++;
			if (isSel) selectedVisible = true;

			if (isOpen && shown < this.maxVisibleLines) {
				const wrapped = wrapTextWithAnsi(entry.thinking, bodyWidth);
				const capped = wrapped.slice(0, this.maxExpandedLines);
				for (const bodyLine of capped) {
					if (shown >= this.maxVisibleLines) break;
					out.push(`    ${theme.fg("thinkingText", theme.italic(truncateToWidth(bodyLine, bodyWidth, "")))}`);
					shown++;
				}
				if (wrapped.length > this.maxExpandedLines && shown < this.maxVisibleLines) {
					out.push(theme.fg("dim", `    … +${wrapped.length - this.maxExpandedLines} more lines`));
					shown++;
				}
			}
			i++;
		}

		return { lines: out, selectedVisible };
	}
}
