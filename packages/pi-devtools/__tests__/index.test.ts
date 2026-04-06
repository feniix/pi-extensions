import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("pi-devtools", () => {
	describe("package", () => {
		it("should have correct name", () => {
			const pkg = JSON.parse(readFileSync(join(__dirname, "../package.json"), "utf-8"));
			expect(pkg.name).toBe("@feniix/pi-devtools");
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

		it("should have correct description", () => {
			const pkg = JSON.parse(readFileSync(join(__dirname, "../package.json"), "utf-8"));
			expect(pkg.description).toContain("Devtools");
		});
	});

	describe("skills", () => {
		it("should have brpr skill", () => {
			const skill = readFileSync(join(__dirname, "../skills/brpr/SKILL.md"), "utf-8");
			expect(skill).toContain("brpr");
			expect(skill).toContain("Branch, commit, push, and open a PR");
		});

		it("should have release skill", () => {
			const skill = readFileSync(join(__dirname, "../skills/release/SKILL.md"), "utf-8");
			expect(skill).toContain("release");
			expect(skill).toContain("Automate the release process");
		});

		it("should have merge skill", () => {
			const skill = readFileSync(join(__dirname, "../skills/merge/SKILL.md"), "utf-8");
			expect(skill).toContain("merge");
			expect(skill).toContain("Merge or squash-merge a pull request");
		});
	});

	describe("tools", () => {
		it("should register branch tools", () => {
			const extension = readFileSync(join(__dirname, "../extensions/index.ts"), "utf-8");
			expect(extension).toContain("devtools_create_branch");
			expect(extension).toContain("devtools_commit");
			expect(extension).toContain("devtools_push");
		});

		it("should register PR tools", () => {
			const extension = readFileSync(join(__dirname, "../extensions/index.ts"), "utf-8");
			expect(extension).toContain("devtools_create_pr");
			expect(extension).toContain("devtools_merge_pr");
			expect(extension).toContain("devtools_squash_merge_pr");
		});

		it("should register release tools", () => {
			const extension = readFileSync(join(__dirname, "../extensions/index.ts"), "utf-8");
			expect(extension).toContain("devtools_get_latest_tag");
			expect(extension).toContain("devtools_analyze_commits");
			expect(extension).toContain("devtools_bump_version");
			expect(extension).toContain("devtools_create_release");
		});

		it("should register CI check tool", () => {
			const extension = readFileSync(join(__dirname, "../extensions/index.ts"), "utf-8");
			expect(extension).toContain("devtools_check_ci");
		});

		it("should register repo info tool", () => {
			const extension = readFileSync(join(__dirname, "../extensions/index.ts"), "utf-8");
			expect(extension).toContain("devtools_get_repo_info");
		});
	});
});
