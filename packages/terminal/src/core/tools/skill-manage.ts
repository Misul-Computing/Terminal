/**
 * skill_manage tool: structured create/patch/delete for agent skills.
 *
 * Validates name + frontmatter, writes SKILL.md under the agent skills dir.
 * Thin wrapper over fs - no abstractions, no database, no index.
 */

import type { AgentToolResult } from "@misul/agent-core";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Static, Type } from "typebox";
import { getAgentDir } from "../../config.ts";
import { defineTool, type ToolDefinition } from "../extensions/types.ts";

const MAX_NAME_LENGTH = 64;
const MAX_BODY_CHARS = 16000;

const skillManageSchema = Type.Object({
	action: Type.Union([Type.Literal("create"), Type.Literal("patch"), Type.Literal("delete")], {
		description: "create: new skill (fails if exists). patch: update existing. delete: remove skill.",
	}),
	name: Type.String({
		description: "Skill name: lowercase a-z, 0-9, hyphens. Max 64 chars. Used as directory name.",
	}),
	description: Type.Optional(
		Type.String({ description: "One-line description for the skill (required for create, optional for patch)." }),
	),
	body: Type.Optional(
		Type.String({ description: "Markdown body of the skill (after frontmatter). Required for create." }),
	),
});

type SkillManageParams = Static<typeof skillManageSchema>;

function validateName(name: string): string | null {
	if (!name) return "name is required";
	if (name.length > MAX_NAME_LENGTH) return `name exceeds ${MAX_NAME_LENGTH} chars`;
	if (!/^[a-z0-9-]+$/.test(name)) return "name must be lowercase a-z, 0-9, hyphens only";
	if (name.startsWith("-") || name.endsWith("-")) return "name must not start or end with hyphen";
	if (name.includes("--")) return "name must not contain consecutive hyphens";
	return null;
}

function skillDir(name: string): string {
	return join(getAgentDir(), "skills", name);
}

function skillPath(name: string): string {
	return join(skillDir(name), "SKILL.md");
}

function buildSkillFile(name: string, description: string, body: string): string {
	const desc = description.includes("\n")
		? `>\n  ${description.split("\n").join("\n  ")}`
		: description;
	return `---\nname: ${name}\ndescription: ${desc}\n---\n\n${body}\n`;
}

function readExisting(path: string): { description: string; body: string } | null {
	if (!existsSync(path)) return null;
	const raw = readFileSync(path, "utf-8");
	const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
	if (!match) return { description: "", body: raw };
	const frontmatter = match[1];
	const body = match[2].trim();
	const descMatch = frontmatter.match(/^description:\s*(?:>\n\s+)?([\s\S]*?)(?:\n\S|$)/m);
	const description = descMatch ? descMatch[1].replace(/\n\s+/g, " ").trim() : "";
	return { description, body };
}

export function createSkillManageTool(): ToolDefinition {
	return defineTool({
		name: "skill_manage",
		label: "Manage Skill",
		description:
			"Create, update, or delete an agent skill (SKILL.md). Skills are reusable procedural prompts " +
			"stored under ~/.misul/agent/skills/<name>/SKILL.md. Use this instead of raw file writes for skills.",
		promptSnippet: "skill_manage(action, name, description?, body?): create/patch/delete a skill.",
		executionMode: "sequential",
		parameters: skillManageSchema,
		execute: async (_id, params: SkillManageParams): Promise<AgentToolResult<undefined>> => {
			const nameErr = validateName(params.name);
			if (nameErr) return textResult(`Error: ${nameErr}`);

			const dir = skillDir(params.name);
			const path = skillPath(params.name);

			if (params.action === "create") {
				if (existsSync(path)) return textResult(`Error: skill "${params.name}" already exists. Use patch.`);
				if (!params.description) return textResult("Error: description is required for create.");
				if (!params.body) return textResult("Error: body is required for create.");
				if (params.body.length > MAX_BODY_CHARS)
					return textResult(`Error: body exceeds ${MAX_BODY_CHARS} chars.`);

				mkdirSync(dir, { recursive: true });
				writeFileSync(path, buildSkillFile(params.name, params.description, params.body));
				return textResult(`Created skill "${params.name}" at ${path}.`);
			}

			if (params.action === "patch") {
				const existing = readExisting(path);
				if (!existing) return textResult(`Error: skill "${params.name}" does not exist. Use create.`);
				const description = params.description ?? existing.description;
				const body = params.body ?? existing.body;
				if (body.length > MAX_BODY_CHARS)
					return textResult(`Error: body exceeds ${MAX_BODY_CHARS} chars.`);

				writeFileSync(path, buildSkillFile(params.name, description, body));
				return textResult(`Updated skill "${params.name}".`);
			}

			// delete
			if (!existsSync(path)) return textResult(`Error: skill "${params.name}" does not exist.`);
			rmSync(dir, { recursive: true });
			return textResult(`Deleted skill "${params.name}".`);
		},
	});
}

function textResult(text: string): AgentToolResult<undefined> {
	return { content: [{ type: "text", text }], details: undefined };
}
