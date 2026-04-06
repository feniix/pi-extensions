import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("pi-notion", () => {
	describe("package", () => {
		it("should have correct name", () => {
			const pkg = JSON.parse(readFileSync(join(__dirname, "../package.json"), "utf-8"));
			expect(pkg.name).toBe("@feniix/pi-notion");
		});

		it("should have version", () => {
			const pkg = JSON.parse(readFileSync(join(__dirname, "../package.json"), "utf-8"));
			expect(pkg.version).toBeTruthy();
		});

		it("should have pi extension entry point", () => {
			const pkg = JSON.parse(readFileSync(join(__dirname, "../package.json"), "utf-8"));
			expect(pkg.pi).toBeDefined();
			expect(pkg.pi.extensions).toContain("./extensions/index.ts");
		});

		it("should have axios dependency", () => {
			const pkg = JSON.parse(readFileSync(join(__dirname, "../package.json"), "utf-8"));
			expect(pkg.dependencies).toHaveProperty("axios");
		});

		it("should have skills declared", () => {
			const pkg = JSON.parse(readFileSync(join(__dirname, "../package.json"), "utf-8"));
			expect(pkg.pi.skills).toBeDefined();
		});
	});

	describe("tools", () => {
		it("should register page tools", () => {
			const extension = readFileSync(join(__dirname, "../extensions/index.ts"), "utf-8");
			expect(extension).toContain("notion_get_page");
			expect(extension).toContain("notion_create_page");
			expect(extension).toContain("notion_update_page");
			expect(extension).toContain("notion_archive_page");
		});

		it("should register database tools", () => {
			const extension = readFileSync(join(__dirname, "../extensions/index.ts"), "utf-8");
			expect(extension).toContain("notion_get_database");
			expect(extension).toContain("notion_query_database");
			expect(extension).toContain("notion_create_database");
		});

		it("should register search and user tools", () => {
			const extension = readFileSync(join(__dirname, "../extensions/index.ts"), "utf-8");
			expect(extension).toContain("notion_search");
			expect(extension).toContain("notion_get_user");
			expect(extension).toContain("notion_get_me");
		});

		it("should register block tools", () => {
			const extension = readFileSync(join(__dirname, "../extensions/index.ts"), "utf-8");
			expect(extension).toContain("notion_get_block_children");
			expect(extension).toContain("notion_append_blocks");
		});
	});
});
