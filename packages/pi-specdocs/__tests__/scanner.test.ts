import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractFrontmatterField, formatSummary, listMatchingFiles, scanWorkspace } from "../extensions/index.js";

describe("scanner", () => {
  it("returns empty for non-existent directory", () => {
    const files = listMatchingFiles("/tmp/does-not-exist-specdocs", /^PRD-\d{3}-.*\.md$/);
    expect(files).toEqual([]);
  });

  it("lists matching files sorted", () => {
    const base = mkdtempSync(join(tmpdir(), "specdocs-test-"));
    writeFileSync(join(base, "PRD-002-second.md"), "");
    writeFileSync(join(base, "PRD-001-first.md"), "");
    writeFileSync(join(base, "README.md"), "");

    const files = listMatchingFiles(base, /^PRD-\d{3}-.*\.md$/);
    expect(files).toEqual(["PRD-001-first.md", "PRD-002-second.md"]);
  });

  it("extracts frontmatter fields", () => {
    const base = mkdtempSync(join(tmpdir(), "specdocs-fm-"));
    const filepath = join(base, "test.md");
    writeFileSync(
      filepath,
      `---
title: "My Feature"
status: Draft
owner: "Alice"
---

# Content here
`,
    );

    expect(extractFrontmatterField(filepath, "title")).toBe("My Feature");
    expect(extractFrontmatterField(filepath, "status")).toBe("Draft");
    expect(extractFrontmatterField(filepath, "owner")).toBe("Alice");
    expect(extractFrontmatterField(filepath, "missing")).toBe("");
  });

  it("returns empty string for files without frontmatter", () => {
    const base = mkdtempSync(join(tmpdir(), "specdocs-nofm-"));
    const filepath = join(base, "test.md");
    writeFileSync(filepath, "# Just a heading\n\nNo frontmatter here.\n");

    expect(extractFrontmatterField(filepath, "title")).toBe("");
  });

  it("scans workspace and identifies drafts and proposed", () => {
    const base = mkdtempSync(join(tmpdir(), "specdocs-scan-"));
    const prdDir = join(base, "docs", "prd");
    const adrDir = join(base, "docs", "adr");
    const planDir = join(base, "docs", "architecture");
    mkdirSync(prdDir, { recursive: true });
    mkdirSync(adrDir, { recursive: true });
    mkdirSync(planDir, { recursive: true });

    writeFileSync(join(prdDir, "PRD-001-auth.md"), '---\ntitle: "Auth Feature"\nstatus: Draft\n---\n# Auth\n');
    writeFileSync(join(prdDir, "PRD-002-cache.md"), '---\ntitle: "Cache Layer"\nstatus: Approved\n---\n# Cache\n');
    writeFileSync(
      join(adrDir, "ADR-0001-db-choice.md"),
      '---\ntitle: "PostgreSQL vs DynamoDB"\nstatus: Proposed\n---\n# DB\n',
    );
    writeFileSync(
      join(adrDir, "ADR-0002-api-style.md"),
      '---\ntitle: "REST vs GraphQL"\nstatus: Accepted\n---\n# API\n',
    );
    writeFileSync(join(planDir, "plan-auth.md"), "# Auth Plan\n");

    const result = scanWorkspace(base);
    expect(result.prdFiles).toHaveLength(2);
    expect(result.adrFiles).toHaveLength(2);
    expect(result.planFiles).toHaveLength(1);
    expect(result.draftPrds).toEqual(["Auth Feature"]);
    expect(result.proposedAdrs).toEqual(["PostgreSQL vs DynamoDB"]);
  });

  it("formats summary correctly", () => {
    const summary = formatSummary({
      prdFiles: ["PRD-001-auth.md", "PRD-002-cache.md"],
      adrFiles: ["ADR-0001-db.md"],
      planFiles: ["plan-auth.md"],
      proposedAdrs: ["PostgreSQL vs DynamoDB"],
      draftPrds: ["Auth Feature"],
    });

    expect(summary).toContain("[specdocs] Workspace: 2 PRDs, 1 ADRs, 1 plans");
    expect(summary).toContain("[specdocs] Proposed ADRs needing review:");
    expect(summary).toContain("  - PostgreSQL vs DynamoDB");
    expect(summary).toContain("[specdocs] Draft PRDs:");
    expect(summary).toContain("  - Auth Feature");
  });

  it("returns null when no docs exist", () => {
    const summary = formatSummary({
      prdFiles: [],
      adrFiles: [],
      planFiles: [],
      proposedAdrs: [],
      draftPrds: [],
    });
    expect(summary).toBeNull();
  });
});
