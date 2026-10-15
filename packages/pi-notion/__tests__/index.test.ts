import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const pkg = JSON.parse(readFileSync(join(__dirname, "../package.json"), "utf-8"));

describe("pi-notion package", () => {
  it("has the expected name and a version", () => {
    expect(pkg.name).toBe("@feniix/pi-notion");
    expect(pkg.version).toBeTruthy();
  });

  it("loads one extension entry point and the skills", () => {
    expect(pkg.pi.extensions).toEqual(["./extensions/index.ts"]);
    expect(pkg.pi.skills).toEqual(["./skills"]);
  });

  it("has no runtime dependencies, since pi's built-in MCP support is the client", () => {
    expect(pkg.dependencies ?? {}).toEqual({});
  });

  it("ships the workspace-explorer skill; sign-in needs no skill", () => {
    expect(existsSync(join(__dirname, "../skills/setup-oauth"))).toBe(false);
    expect(existsSync(join(__dirname, "../skills/workspace-explorer/SKILL.md"))).toBe(true);
  });

  it("names only tools Notion's MCP server offers", () => {
    // Notion's tool list on 2026-10-15; the skill once named notion-query-database-view, which no longer exists
    const notionTools = new Set([
      "notion-search",
      "notion-memory-search",
      "notion-get-tool-access",
      "notion-fetch",
      "notion-create-attachment",
      "notion-create-file-upload",
      "notion-download-attachment",
      "notion-get-file-download-urls",
      "notion-create-pages",
      "notion-update-page",
      "notion-delete-pages",
      "notion-delete-databases",
      "notion-restore-pages",
      "notion-convert-page-to-skill",
      "notion-upload-skill",
      "notion-download-skill",
      "notion-get-enabled-skills",
      "notion-update-enabled-skills",
      "notion-move-pages",
      "notion-duplicate-page",
      "notion-create-database",
      "notion-create-folder",
      "notion-update-folder",
      "notion-update-data-source",
      "notion-create-comment",
      "notion-get-comments",
      "notion-update-comment",
      "notion-delete-comment",
      "notion-set-discussion-resolved",
      "notion-set-comment-reaction",
      "notion-get-async-task",
      "notion-get-teams",
      "notion-get-groups",
      "notion-get-users",
      "notion-query-data-sources",
      "notion-query-multiple-data-sources",
      "notion-query-meeting-notes",
      "notion-list-private-pages",
      "notion-list-shared-pages",
      "notion-list-favorite-pages",
      "notion-list-recent-pages",
      "notion-search-agents",
      "notion-search-sessions",
      "notion-query-sessions",
      "notion-spawn-session",
      "notion-get-session-status",
      "notion-wait-session",
      "notion-stop-session",
      "notion-send-message-to-session",
      "notion-list-session-events",
      "notion-read-session-event",
      "notion-create-view",
      "notion-update-view",
      "notion-list-page-backlinks",
      "notion-get-self",
      "notion-show-advanced-analysis-next-steps",
      "notion-check-mcp-next-steps",
    ]);
    const skillDir = join(__dirname, "../skills/workspace-explorer");
    const files = ["SKILL.md", ...readdirSync(join(skillDir, "references")).map((f) => `references/${f}`)];
    const named = files.flatMap(
      (f) => readFileSync(join(skillDir, f), "utf-8").match(/\bnotion-[a-z]+(?:-[a-z]+)*/g) ?? [],
    );

    expect(named.filter((name) => !notionTools.has(name))).toEqual([]);
  });
});
