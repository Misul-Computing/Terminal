import { Container, type SelectItem, SelectList, type SelectListLayoutOptions } from "@misul/tui";
import { getSelectListTheme } from "../theme/theme.ts";
import { DynamicBorder } from "./dynamic-border.ts";

const SKILLS_SELECT_LIST_LAYOUT: SelectListLayoutOptions = {
	minPrimaryColumnWidth: 16,
	maxPrimaryColumnWidth: 40,
};

const MAX_VISIBLE_ROWS = 12;

/**
 * The single /skills menu: lists the available skills (individual skills are no
 * longer shown as separate slash commands). Selecting one invokes it.
 */
export class SkillsSelectorComponent extends Container {
	private selectList: SelectList;

	constructor(skills: Array<{ name: string; description: string }>, onSelect: (name: string) => void, onCancel: () => void) {
		super();

		const items: SelectItem[] = skills.map((skill) => ({
			value: skill.name,
			label: skill.name,
			description: skill.description,
		}));

		this.addChild(new DynamicBorder());
		this.selectList = new SelectList(
			items,
			Math.min(items.length, MAX_VISIBLE_ROWS),
			getSelectListTheme(),
			SKILLS_SELECT_LIST_LAYOUT,
		);
		this.selectList.onSelect = (item) => onSelect(item.value as string);
		this.selectList.onCancel = () => onCancel();
		this.addChild(this.selectList);
		this.addChild(new DynamicBorder());
	}

	getSelectList(): SelectList {
		return this.selectList;
	}
}
