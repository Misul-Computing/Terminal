import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Container, Spacer, Text } from "@misul/tui";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { handleInstantToolCommand } from "../src/core/instant-tools.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

function createTestContext(): {
	cwd: string;
	chatContainer: Container;
	errors: string[];
	statuses: string[];
	todos: string[];
	requestRender: () => void;
	showError: (message: string) => void;
	showStatus: (message: string) => void;
	getTodos: () => string[];
	setTodos: (todos: string[]) => void;
} {
	const errors: string[] = [];
	const statuses: string[] = [];
	const todos: string[] = [];
	return {
		cwd: process.cwd(),
		chatContainer: new Container(),
		get errors() {
			return errors;
		},
		get statuses() {
			return statuses;
		},
		get todos() {
			return todos;
		},
		requestRender: () => {},
		showError: (message) => errors.push(message),
		showStatus: (message) => statuses.push(message),
		getTodos: () => todos,
		setTodos: (updated) => {
			todos.length = 0;
			todos.push(...updated);
		},
	};
}

function collectText(container: Container): string {
	return container
		.render(120)
		.join("\n")
		.replace(/\x1b\[[0-9;]*m/g, "");
}

describe("instant tools", () => {
	let tempDir: string;
	let ctx: ReturnType<typeof createTestContext>;

	beforeAll(() => {
		initTheme("dark");
		tempDir = mkdtempSync(join(tmpdir(), "misul-instant-tools-"));
	});

	beforeEach(() => {
		ctx = createTestContext();
		ctx.cwd = tempDir;
	});

	afterAll(() => {
		try {
			import("node:fs").then(({ rmSync }) => rmSync(tempDir, { recursive: true, force: true })).catch(() => {});
		} catch {}
	});

	it("/read displays file contents", async () => {
		writeFileSync(join(tempDir, "sample.txt"), "line1\nline2\nline3");
		const handled = await handleInstantToolCommand("/read sample.txt", ctx);
		expect(handled).toBe(true);
		const text = collectText(ctx.chatContainer);
		expect(text).toContain("line1");
		expect(text).toContain("line2");
		expect(text).toContain("line3");
	});

	it("/read reports an error for missing files", async () => {
		const handled = await handleInstantToolCommand("/read missing.txt", ctx);
		expect(handled).toBe(true);
		expect(ctx.errors.length).toBeGreaterThan(0);
	});

	it("/edit applies a simple replacement", async () => {
		writeFileSync(join(tempDir, "edit.txt"), "hello world");
		const handled = await handleInstantToolCommand('/edit edit.txt "hello" "hi"', ctx);
		expect(handled).toBe(true);
		expect(ctx.errors).toHaveLength(0);
		const text = collectText(ctx.chatContainer);
		expect(text).toContain("Updated successfully");
		const content = await import("node:fs/promises").then(({ readFile }) => readFile(join(tempDir, "edit.txt"), "utf8"));
		expect(content).toBe("hi world");
	});

	it("/edit rejects non-unique old text", async () => {
		writeFileSync(join(tempDir, "dup.txt"), "foo foo");
		const handled = await handleInstantToolCommand('/edit dup.txt "foo" "bar"', ctx);
		expect(handled).toBe(true);
		expect(ctx.errors.length).toBeGreaterThan(0);
	});

	it("/edit rejects empty old text", async () => {
		writeFileSync(join(tempDir, "empty.txt"), "hello");
		const handled = await handleInstantToolCommand('/edit empty.txt "" "x"', ctx);
		expect(handled).toBe(true);
		expect(ctx.errors.length).toBeGreaterThan(0);
	});

	it("/todo shows items and adds new ones", async () => {
		let handled = await handleInstantToolCommand("/todo first item", ctx);
		expect(handled).toBe(true);
		handled = await handleInstantToolCommand("/todo second item", ctx);
		expect(handled).toBe(true);
		expect(ctx.todos).toEqual(["first item", "second item"]);
		handled = await handleInstantToolCommand("/todo", ctx);
		expect(handled).toBe(true);
		const text = collectText(ctx.chatContainer);
		expect(text).toContain("first item");
		expect(text).toContain("second item");
	});

	it("returns false for unknown slash commands", async () => {
		const handled = await handleInstantToolCommand("/unknown", ctx);
		expect(handled).toBe(false);
	});

	it("rejects paths outside the project directory", async () => {
		writeFileSync(join(tempDir, "safe.txt"), "safe");
		const handled = await handleInstantToolCommand("/read ../safe.txt", ctx);
		expect(handled).toBe(true);
		expect(ctx.errors.length).toBeGreaterThan(0);
	});

	it("returns false for non-slash text", async () => {
		const handled = await handleInstantToolCommand("hello", ctx);
		expect(handled).toBe(false);
	});
});
