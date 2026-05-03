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
      expect(skill).toContain("web_find_similar_exa");
    });

    it("personal-site-search explains when to use find-similar vs search", () => {
      const skill = readFileSync(join(__dirname, "../skills/personal-site-search/SKILL.md"), "utf-8");
      expect(skill).toContain("find more like this");
      expect(skill).toContain("web_find_similar_exa");
      expect(skill).toContain("web_search_exa");
    });

    it("skills only mention supported tool parameters", () => {
      const skillFiles = [
        "code-search",
        "company-research",
        "exa-research-planner",
        "financial-report-search",
        "people-research",
        "personal-site-search",
        "research-paper-search",
      ];

      for (const skillName of skillFiles) {
        const skill = readFileSync(join(__dirname, `../skills/${skillName}/SKILL.md`), "utf-8");
        expect(skill).not.toContain("excludeText");
      }
    });

    it("structured outputSchema skill examples define array items", () => {
      const financialSkill = readFileSync(join(__dirname, "../skills/financial-report-search/SKILL.md"), "utf-8");
      const peopleSkill = readFileSync(join(__dirname, "../skills/people-research/SKILL.md"), "utf-8");

      expect(financialSkill).toContain('"risks": { "type": "array", "items": { "type": "string" } }');
      expect(peopleSkill).toContain('"experts": { "type": "array", "items": { "type": "object" } }');
    });

    it("exa-research-planner supports explicit deep research execution", () => {
      const skill = readFileSync(join(__dirname, "../skills/exa-research-planner/SKILL.md"), "utf-8");

      expect(skill).toContain("Explicit deep-research execution");
      expect(skill).toContain("A direct user request to run deep research counts as approval");
      expect(skill).toContain("web_research_exa");
    });

    it("exa-research-planner requires paper retrieval for white paper sources", () => {
      const skill = readFileSync(join(__dirname, "../skills/exa-research-planner/SKILL.md"), "utf-8");

      expect(skill).toContain("White Papers and Source Retrieval");
      expect(skill).toContain("return the actual paper URLs");
      expect(skill).toContain("web_fetch_exa");
    });

    it("exa-research-planner requires paper contents to inform synthesis", () => {
      const skill = readFileSync(join(__dirname, "../skills/exa-research-planner/SKILL.md"), "utf-8");

      expect(skill).toContain("Paper Content Synthesis Rule");
      expect(skill).toContain("Do not rely only on `web_research_exa` synthesis");
      expect(skill).toContain("Use fetched paper contents as first-class evidence");
    });

    it("exa-research-planner supports iterative discovery and clarification", () => {
      const skill = readFileSync(join(__dirname, "../skills/exa-research-planner/SKILL.md"), "utf-8");

      expect(skill).toContain("Iterative Discovery and Clarification Loop");
      expect(skill).toContain("Run multiple cheap discovery rounds when each round changes the plan");
      expect(skill).toContain("Ask the user one focused clarification question");
    });

    it("exa-research-planner presents human-readable drafts before payloads", () => {
      const skill = readFileSync(join(__dirname, "../skills/exa-research-planner/SKILL.md"), "utf-8");

      expect(skill).toContain("Human-Readable Drafts First");
      expect(skill).toContain("Show the user the research plan in human-consumable form first");
      expect(skill).toContain("Do not lead with raw JSON");
    });

    it("exa-research-planner does not reference unimplemented planning tools", () => {
      const skill = readFileSync(join(__dirname, "../skills/exa-research-planner/SKILL.md"), "utf-8");

      expect(skill).not.toContain("PRD-008");
      expect(skill).not.toContain("exa_research_step");
      expect(skill).not.toContain("exa_research_summary");
    });
  });
});
