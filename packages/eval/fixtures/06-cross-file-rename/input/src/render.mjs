import { formatLabel } from "./format.mjs";

export function render(items) {
	return items.map(formatLabel).join(" ");
}
