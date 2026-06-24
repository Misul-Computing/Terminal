import { type Component, visibleWidth } from "@misul/tui";
import { theme } from "../theme/theme.ts";

/**
 * Renders a collapsible block header with the label centered and the
 * expand/collapse marker on the right: "  Thinking  −" (expanded) /
 * "  Thinking  +" (collapsed). Minus means content is visible, plus means
 * content is hidden.
 *
 * When `selected` is true, the header is highlighted to indicate the cursor
 * is on this block (enter toggles it).
 */
export class CollapsibleHeader implements Component {
	private expanded: boolean;
	private selected: boolean;
	private labelText: string;

	constructor(label: string, expanded: boolean, selected = false) {
		this.labelText = label;
		this.expanded = expanded;
		this.selected = selected;
	}

	setExpanded(expanded: boolean): void {
		this.expanded = expanded;
	}

	setSelected(selected: boolean): void {
		this.selected = selected;
	}

	isExpanded(): boolean {
		return this.expanded;
	}

	isSelected(): boolean {
		return this.selected;
	}

	invalidate(): void {}

	render(width: number): string[] {
		const marker = this.expanded ? "−" : "+";
		const label = `${this.labelText}  ${marker}`;
		const styled = this.selected
			? theme.bold(theme.fg("accent", label))
			: theme.fg("muted", label);
		const labelWidth = visibleWidth(styled);
		const leftPad = Math.max(0, Math.floor((width - labelWidth) / 2));
		return [" ".repeat(leftPad) + styled];
	}
}
