import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { toolDefinitions } from "../extensions/index.js";

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

  const readResource = (path: string) => readFileSync(join(__dirname, "..", path), "utf-8");

  describe("skills", () => {
    it("should have brpr skill", () => {
      const skill = readFileSync(join(__dirname, "../skills/brpr/SKILL.md"), "utf-8");
      expect(skill).toContain("brpr");
      expect(skill).toContain("Branch, Push, and PR Workflow");
      expect(skill).toMatch(/active working directory/i);
      expect(skill).toMatch(/linked worktree/i);
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

    it("documents separate merge cleanup outcomes without unsafe post-merge commands", () => {
      const resources = ["skills/merge/SKILL.md", "prompts/md.md", "prompts/smd.md"].map(readResource);

      for (const resource of resources) {
        expect(resource).toContain("remoteCleanup");
        expect(resource).toContain("localCleanup");
        expect(resource.indexOf("mergeStatus")).toBeLessThan(resource.indexOf("remoteCleanup"));
        expect(resource).toMatch(/pending[\s\S]*queued|queued[\s\S]*pending/i);
        expect(resource).toMatch(/pending[\s\S]*cleanup (?:was )?skipped/i);
        expect(resource).toMatch(
          /unknown[\s\S]*(?:could not be confirmed|unconfirmed)[\s\S]*cleanup (?:was )?skipped/i,
        );
        expect(resource).toMatch(/unknown[\s\S]*(?:do not|must not)[\s\S]*retr(?:y|ied)/i);
        expect(resource).toMatch(/only (?:when|for)[\s\S]*merged[\s\S]*incomplete cleanup/i);
        expect(resource).toMatch(/retained local branch/i);
        expect(resource).toMatch(/merge (?:still |remains )?successful|successful merge/i);
        expect(resource).not.toMatch(/checkout (?:the )?(?:main|default|main\/default) branch/i);
        expect(resource).not.toMatch(/pull to update/i);
        expect(resource).not.toMatch(/confirm the branch was deleted/i);
      }
    });

    it("keeps release safety gates without prescribing a default-branch checkout", () => {
      const skill = readResource("skills/release/SKILL.md");

      expect(skill).toMatch(/default branch/i);
      expect(skill).toMatch(/working tree is clean/i);
      expect(skill).toMatch(/another worktree/i);
      expect(skill).not.toMatch(/checkout (?:the )?(?:main|default) branch/i);
    });
  });

  describe("documentation", () => {
    it("documents active-cwd and non-mutating worktree behavior", () => {
      const readme = readResource("README.md");

      expect(readme).toMatch(/Pi(?:'s)? active (?:working directory|cwd)/i);
      expect(readme).toMatch(/linked worktree/i);
      expect(readme).toMatch(/detached HEAD/i);
      expect(readme).toMatch(/occupied branches? (?:are|is) retained/i);
      expect(readme).toMatch(/never create, remove, unlock, or prune worktrees/i);
    });

    it("lists only registered devtools tools in README Tools tables", () => {
      const readme = readResource("README.md");
      const toolsSection = readme.match(/## Tools\n([\s\S]*?)\n## Skills/)?.[1] ?? "";
      const documentedTools = [...toolsSection.matchAll(/`(devtools_[a-z0-9_]+)`/g)].map((match) => match[1]);
      const registeredToolNames = toolDefinitions.map(({ name }) => name);
      const documentedToolSet = new Set(documentedTools);
      const registeredToolSet = new Set<string>(registeredToolNames);

      expect(documentedTools.length).toBeGreaterThan(0);
      expect(documentedToolSet.size).toBe(documentedTools.length);
      expect(registeredToolSet.size).toBe(registeredToolNames.length);
      expect(documentedTools.filter((name) => !registeredToolSet.has(name))).toEqual([]);
      expect(registeredToolNames.filter((name) => !documentedToolSet.has(name))).toEqual([]);
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
      const parameters = readResource("extensions/tool-params.ts");
      expect(extension).toContain("devtools_create_pr");
      expect(extension).toContain("devtools_merge_pr");
      expect(extension).toContain("devtools_squash_merge_pr");
      expect(parameters).toMatch(/request best-effort remote and local cleanup/i);
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
      expect(extension).toMatch(/active worktree/i);
      expect(extension).toMatch(/best-effort remote and local branch cleanup/i);
    });
  });
});
