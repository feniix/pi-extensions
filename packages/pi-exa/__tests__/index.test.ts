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

		it("should use relative Exa SDK endpoints instead of full API URLs", () => {
			const extension = readFileSync(join(__dirname, "../extensions/index.ts"), "utf-8");
			expect(extension).toContain('exa.request<ExaSearchResponse>("/search", "POST", searchRequest)');
			expect(extension).toContain('}>("/contents", "POST", crawlRequest)');
			expect(extension).not.toContain(
				'exa.request<ExaSearchResponse>("https://api.exa.ai/search", "POST", searchRequest)',
			);
			expect(extension).not.toContain('}>("https://api.exa.ai/contents", "POST", crawlRequest)');
		});
	});

	describe("skills", () => {
		it("should have code-search skill", () => {
			const skill = readFileSync(join(__dirname, "../skills/code-search/SKILL.md"), "utf-8");
			expect(skill).toContain("web_search_exa");
		});

		it("should have company-research skill", () => {
			const skill = readFileSync(join(__dirname, "../skills/company-research/SKILL.md"), "utf-8");
			expect(skill).toContain("web_search_exa");
		});

		it("should have people-research skill", () => {
			const skill = readFileSync(join(__dirname, "../skills/people-research/SKILL.md"), "utf-8");
			expect(skill).toContain("web_search_exa");
		});

		it("should have research-paper-search skill", () => {
			const skill = readFileSync(join(__dirname, "../skills/research-paper-search/SKILL.md"), "utf-8");
			expect(skill).toContain("web_search_exa");
		});

		it("should have financial-report-search skill", () => {
			const skill = readFileSync(join(__dirname, "../skills/financial-report-search/SKILL.md"), "utf-8");
			expect(skill).toContain("web_search_exa");
		});

		it("should have personal-site-search skill", () => {
			const skill = readFileSync(join(__dirname, "../skills/personal-site-search/SKILL.md"), "utf-8");
			expect(skill).toContain("web_search_exa");
		});
	});
});
