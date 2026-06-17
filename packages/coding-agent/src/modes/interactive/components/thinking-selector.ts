import type { ThinkingLevel } from "@misul/agent-core";
import { Container, type SelectItem, SelectList, type SelectListLayoutOptions } from "@misul/tui";
import { getSelectListTheme } from "../theme/theme.ts";
import { DynamicBorder } from "./dynamic-border.ts";

const THINKING_SELECT_LIST_LAYOUT: SelectListLayoutOptions = {
	minPrimaryColumnWidth: 12,
	maxPrimaryColumnWidth: 32,
};

// Honest, provider-agnostic labels for the reasoning effort scale. We do NOT
// invent token-budget numbers here: providers differ (OpenAI/OpenRouter use a
// reasoning-effort scale, Anthropic/Google use thinking budgets), and the
// selector only ever shows the levels the SELECTED model actually supports
// (getSupportedThinkingLevels, derived from the model's thinkingLevelMap).
const LEVEL_DESCRIPTIONS: Record<ThinkingLevel, string> = {
	off: "No reasoning",
	minimal: "Minimal reasoning effort",
	low: "Low reasoning effort",
	medium: "Medium reasoning effort",
	high: "High reasoning effort",
	xhigh: "Maximum reasoning effort",
};

/**
 * Component that renders a thinking level selector with borders
 */
export class ThinkingSelectorComponent extends Container {
	private selectList: SelectList;

	constructor(
		currentLevel: ThinkingLevel,
		availableLevels: ThinkingLevel[],
		onSelect: (level: ThinkingLevel) => void,
		onCancel: () => void,
	) {
		super();

		const thinkingLevels: SelectItem[] = availableLevels.map((level) => ({
			value: level,
			label: level,
			description: LEVEL_DESCRIPTIONS[level],
		}));

		// Add top border
		this.addChild(new DynamicBorder());

		// Create selector
		this.selectList = new SelectList(
			thinkingLevels,
			thinkingLevels.length,
			getSelectListTheme(),
			THINKING_SELECT_LIST_LAYOUT,
		);

		// Preselect current level
		const currentIndex = thinkingLevels.findIndex((item) => item.value === currentLevel);
		if (currentIndex !== -1) {
			this.selectList.setSelectedIndex(currentIndex);
		}

		this.selectList.onSelect = (item) => {
			onSelect(item.value as ThinkingLevel);
		};

		this.selectList.onCancel = () => {
			onCancel();
		};

		this.addChild(this.selectList);

		// Add bottom border
		this.addChild(new DynamicBorder());
	}

	getSelectList(): SelectList {
		return this.selectList;
	}
}
