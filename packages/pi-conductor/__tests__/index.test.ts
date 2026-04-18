import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("pi-conductor extension", () => {
	it("registers the main conductor command group", () => {
		const extension = readFileSync(join(__dirname, "../extensions/index.ts"), "utf-8");
		expect(extension).toContain('registerCommand("conductor"');
	});

	it("registers conductor tools", () => {
		const extension = readFileSync(join(__dirname, "../extensions/index.ts"), "utf-8");
		expect(extension).toContain('name: "conductor_status"');
		expect(extension).toContain('name: "conductor_start"');
		expect(extension).toContain('name: "conductor_task_update"');
		expect(extension).toContain('name: "conductor_recover"');
		expect(extension).toContain('name: "conductor_summary_refresh"');
	});
});
