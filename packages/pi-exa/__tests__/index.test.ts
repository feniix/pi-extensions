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

    it("should use typed SDK methods", () => {
      const searchModule = readFileSync(join(__dirname, "../extensions/web-search.ts"), "utf-8");
      const fetchModule = readFileSync(join(__dirname, "../extensions/web-fetch.ts"), "utf-8");
      const answerModule = readFileSync(join(__dirname, "../extensions/web-answer.ts"), "utf-8");
      const findSimilarModule = readFileSync(join(__dirname, "../extensions/web-find-similar.ts"), "utf-8");

      expect(searchModule).toContain("exa.search(");
      expect(fetchModule).toContain("exa.getContents(");
      expect(answerModule).toContain("exa.answer(");
      expect(findSimilarModule).toContain("exa.findSimilar(");
    });
  });

  describe("skills", () => {
    it("code-search references web search and answer tools", () => {
      const skill = readFileSync(join(__dirname, "../skills/code-search/SKILL.md"), "utf-8");
      expect(skill).toContain("web_search_exa");
      expect(skill).toContain("web_answer_exa");
    });

    it("company-research references deep and search tools", () => {
      const skill = readFileSync(join(__dirname, "../skills/company-research/SKILL.md"), "utf-8");
      expect(skill).toContain("web_search_advanced_exa");
      expect(skill).toContain("web_research_exa");
      expect(skill).toContain("web_answer_exa");
    });

    it("people-research references advanced and research tools", () => {
      const skill = readFileSync(join(__dirname, "../skills/people-research/SKILL.md"), "utf-8");
      expect(skill).toContain("web_search_advanced_exa");
      expect(skill).toContain("web_research_exa");
      expect(skill).toContain("web_answer_exa");
    });

    it("research-paper-search references advanced and research tools", () => {
      const skill = readFileSync(join(__dirname, "../skills/research-paper-search/SKILL.md"), "utf-8");
      expect(skill).toContain("web_search_advanced_exa");
      expect(skill).toContain("web_research_exa");
      expect(skill).toContain("web_answer_exa");
    });

    it("financial-report-search references all required tools", () => {
      const skill = readFileSync(join(__dirname, "../skills/financial-report-search/SKILL.md"), "utf-8");
      expect(skill).toContain("web_search_advanced_exa");
      expect(skill).toContain("web_research_exa");
      expect(skill).toContain("web_answer_exa");
    });

    it("personal-site-search references all required tools", () => {
      const skill = readFileSync(join(__dirname, "../skills/personal-site-search/SKILL.md"), "utf-8");
      expect(skill).toContain("web_search_advanced_exa");
      expect(skill).toContain("web_research_exa");
      expect(skill).toContain("web_answer_exa");
    });
  });
});
