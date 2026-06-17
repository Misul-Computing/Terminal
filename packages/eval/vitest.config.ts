import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		testTimeout: 120000, // headless AgentSession creation is slow (P10 startup perf bug); headroom for serial real-session tests
		fileParallelism: false, // serial to avoid parallel-contention timeout spiral; revert once P10 makes startup fast
		// Only our own tests; fixture `*.test.mjs` files are graded oracles, not vitest suites.
		include: ["test/**/*.test.ts"],
	},
});
