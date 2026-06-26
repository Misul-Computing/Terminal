/**
 * Bash Spawn Hook Example
 *
 * Adjusts command, cwd, and env before execution.
 *
 * Usage:
 *   misul -e ./bash-spawn-hook.ts
 */

import type { ExtensionAPI } from "@misul/terminal";
import { createBashTool } from "@misul/terminal";

export default function (api: ExtensionAPI) {
	const cwd = process.cwd();

	const bashTool = createBashTool(cwd, {
		spawnHook: ({ command, cwd, env }) => ({
			command: `source ~/.profile\n${command}`,
			cwd,
			env: { ...env, MISUL_SPAWN_HOOK: "1" },
		}),
	});

	api.registerTool({
		...bashTool,
		execute: async (id, params, signal, onUpdate, _ctx) => {
			return bashTool.execute(id, params, signal, onUpdate);
		},
	});
}
