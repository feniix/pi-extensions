import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("pi-exa", () => {
	describe("package", () => {
		it("should have correct name", () => {
			const pkg = JSON.parse(readFileSync(join(__dirname, "../package.json"), "utf-8"));
			expect(pkg.name).toBe("@feniix/pi-exa");
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

		it("should have exa-js dependency", () => {
			const pkg = JSON.parse(readFileSync(join(__dirname, "../package.json"), "utf-8"));
			expect(pkg.dependencies).toHaveProperty("exa-js");
		});
	});

	describe("skills", () => {
		it("should have code-search skill", () => {
			const skill = readFileSync(join(__dirname, "../skills/code-search/SKILL.md"), "utf-8");
			expect(skill).toContain("code-search-exa");
		});

		it("should have company-research skill", () => {
			const skill = readFileSync(join(__dirname, "../skills/company-research/SKILL.md"), "utf-8");
			expect(skill).toContain("company-research-exa");
		});

		it("should have people-research skill", () => {
			const skill = readFileSync(join(__dirname, "../skills/people-research/SKILL.md"), "utf-8");
			expect(skill).toContain("people-research-exa");
		});

		it("should have research-paper-search skill", () => {
			const skill = readFileSync(join(__dirname, "../skills/research-paper-search/SKILL.md"), "utf-8");
			expect(skill).toContain("research-paper-search-exa");
		});

		it("should have financial-report-search skill", () => {
			const skill = readFileSync(join(__dirname, "../skills/financial-report-search/SKILL.md"), "utf-8");
			expect(skill).toContain("financial-report-search-exa");
		});

		it("should have personal-site-search skill", () => {
			const skill = readFileSync(join(__dirname, "../skills/personal-site-search/SKILL.md"), "utf-8");
			expect(skill).toContain("personal-site-search-exa");
		});
	});
});
