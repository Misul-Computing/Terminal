import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		testTimeout: 60000, // headless agent runs can be slow
		// Only our own tests; fixture `*.test.mjs` files are graded oracles, not vitest suites.
		include: ["test/**/*.test.ts"],
	},
});
