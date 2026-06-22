import { describe, expect, it } from "vitest";
import { OutputAccumulator } from "../src/core/tools/output-accumulator.ts";

describe("OutputAccumulator", () => {
	it("decodes a multibyte char split across chunks even when the other stream interleaves", () => {
		// "€" is E2 82 AC. Split it across two stdout chunks with a stderr chunk in
		// between. A single shared streaming decoder would corrupt the buffered bytes;
		// per-stream decoders must keep them separate.
		const euro = Buffer.from("€", "utf-8");
		const acc = new OutputAccumulator();
		acc.append(euro.subarray(0, 2), "stdout");
		acc.append(Buffer.from("X", "utf-8"), "stderr");
		acc.append(euro.subarray(2), "stdout");
		acc.finish();

		const content = acc.snapshot().content;
		expect(content).toContain("€");
		expect(content).not.toContain("�");
	});
});
