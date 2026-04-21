/**
 * Unit tests for specdocs validation module.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  isAdr,
  isPrd,
  parseFrontmatter,
  validateFrontmatter,
  validateRequiredSections,
  validateRequiredTables,
  validateSpecFile,
} from "../extensions/index.js";

const VALID_PRD = `---
title: "Test PRD"
prd: PRD-001
status: Draft
owner: Test User
date: 2026-04-14
issue: "SPA-99"
version: "1.0"
---

# Test PRD
`;

const VALID_ADR = `---
title: "Test ADR"
adr: ADR-0001
status: Proposed
date: 2026-04-14
prd: "PRD-001-test"
---

# Test ADR
`;

const VALID_PLAN = `---
title: "Test Plan"
prd: "PRD-001-test-feature"
date: 2026-04-14
author: "Test User"
status: Draft
---

# Plan: Test Plan
`;

function writeTempDoc(directory: string, filename: string, content: string): string {
  const filepath = join(directory, filename);
  mkdirSync(join(filepath, ".."), { recursive: true });
  writeFileSync(filepath, content);
  return filepath;
}

// --- Frontmatter parsing ---

describe("parseFrontmatter", () => {
  it("parses valid frontmatter", () => {
    const dir = mkdtempSync(join(tmpdir(), "spec-test-"));
    try {
      const path = join(dir, "test.md");
      writeFileSync(path, VALID_PRD);
      const fields = parseFrontmatter(path);
      expect(fields).not.toBeNull();
      expect(fields?.title).toBe("Test PRD");
      expect(fields?.prd).toBe("PRD-001");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("strips quotes from values", () => {
    const dir = mkdtempSync(join(tmpdir(), "spec-test-"));
    try {
      const path = join(dir, "test.md");
      writeFileSync(path, '---\ntitle: "Quoted Title"\nprd: PRD-001\n---\n');
      const fields = parseFrontmatter(path);
      expect(fields?.title).toBe("Quoted Title");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("returns null for files without frontmatter", () => {
    const dir = mkdtempSync(join(tmpdir(), "spec-test-"));
    try {
      const path = join(dir, "test.md");
      writeFileSync(path, "# Just a heading\n");
      expect(parseFrontmatter(path)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("returns null for nonexistent file", () => {
    expect(parseFrontmatter("/nonexistent/file.md")).toBeNull();
  });

  it("returns null for malformed yaml frontmatter", () => {
    const dir = mkdtempSync(join(tmpdir(), "spec-test-"));
    try {
      const path = join(dir, "test.md");
      writeFileSync(path, '---\ntitle: "Broken"\nstatus: [Draft\n---\n');
      expect(parseFrontmatter(path)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});

// --- Path detection ---

describe("path detection", () => {
  it("detects relative PRD path", () => {
    expect(isPrd("docs/prd/PRD-001-test.md")).toBe(true);
  });

  it("detects absolute PRD path", () => {
    expect(isPrd("/Users/foo/docs/prd/PRD-001-test.md")).toBe(true);
  });

  it("detects relative ADR path", () => {
    expect(isAdr("docs/adr/ADR-0001-test.md")).toBe(true);
  });

  it("detects absolute ADR path", () => {
    expect(isAdr("/Users/foo/docs/adr/ADR-0001-test.md")).toBe(true);
  });

  it("returns false for non-spec paths", () => {
    expect(isPrd("src/main.py")).toBe(false);
    expect(isAdr("src/main.py")).toBe(false);
  });
});

// --- PRD validation ---

describe("validate PRD", () => {
  it("returns no warnings for valid PRD", () => {
    const dir = mkdtempSync(join(tmpdir(), "spec-test-"));
    try {
      const path = writeTempDoc(join(dir, "docs", "prd"), "PRD-001-test.md", VALID_PRD);
      expect(validateFrontmatter(path)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("reports missing required fields", () => {
    const dir = mkdtempSync(join(tmpdir(), "spec-test-"));
    try {
      const content =
        '---\ntitle: "Test"\nprd: PRD-001\nstatus: Draft\ndate: 2026-04-14\nissue: N/A\nversion: "1.0"\n---\n';
      const path = writeTempDoc(join(dir, "docs", "prd"), "PRD-001-test.md", content);
      const warnings = validateFrontmatter(path);
      expect(warnings.some((w) => w.includes("owner"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("reports invalid number format", () => {
    const dir = mkdtempSync(join(tmpdir(), "spec-test-"));
    try {
      const content = VALID_PRD.replace("PRD-001", "PRD-1");
      const path = writeTempDoc(join(dir, "docs", "prd"), "PRD-1-test.md", content);
      const warnings = validateFrontmatter(path);
      expect(warnings.some((w) => w.includes("PRD-NNN"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("reports filename mismatch", () => {
    const dir = mkdtempSync(join(tmpdir(), "spec-test-"));
    try {
      const path = writeTempDoc(join(dir, "docs", "prd"), "PRD-002-test.md", VALID_PRD);
      const warnings = validateFrontmatter(path);
      expect(warnings.some((w) => w.toLowerCase().includes("filename"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("reports invalid status", () => {
    const dir = mkdtempSync(join(tmpdir(), "spec-test-"));
    try {
      const content = VALID_PRD.replace("status: Draft", "status: Banana");
      const path = writeTempDoc(join(dir, "docs", "prd"), "PRD-001-test.md", content);
      const warnings = validateFrontmatter(path);
      expect(warnings.some((w) => w.includes("Banana"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("reports missing frontmatter", () => {
    const dir = mkdtempSync(join(tmpdir(), "spec-test-"));
    try {
      const path = writeTempDoc(join(dir, "docs", "prd"), "PRD-001-test.md", "# No frontmatter\n");
      const warnings = validateFrontmatter(path);
      expect(warnings.some((w) => w.includes("No YAML frontmatter"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("reports malformed yaml frontmatter as a parse error", () => {
    const dir = mkdtempSync(join(tmpdir(), "spec-test-"));
    try {
      const path = writeTempDoc(
        join(dir, "docs", "prd"),
        "PRD-001-test.md",
        '---\ntitle: "Broken"\nstatus: [Draft\nowner: Test\n---\n# Test\n',
      );
      const warnings = validateFrontmatter(path);
      expect(warnings.some((w) => w.includes("Frontmatter parse error"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("reports typed field validation errors for invalid frontmatter field types", () => {
    const dir = mkdtempSync(join(tmpdir(), "spec-test-"));
    try {
      const path = writeTempDoc(
        join(dir, "docs", "prd"),
        "PRD-001-test.md",
        '---\ntitle:\n  nested: nope\nprd: PRD-001\nstatus: Draft\nowner: [Alice]\ndate: 2026-04-14\nissue: 1\nversion: "1.0"\n---\n# Test\n',
      );
      const warnings = validateFrontmatter(path);
      expect(warnings.some((w) => w.includes("Field 'title' must be a string, not an object"))).toBe(true);
      expect(warnings.some((w) => w.includes("Field 'owner' must be a string, not an array"))).toBe(true);
      expect(warnings.some((w) => w.includes("Missing required frontmatter field: title"))).toBe(false);
      expect(warnings.some((w) => w.includes("Missing required frontmatter field: owner"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});

// --- ADR validation ---

describe("validate ADR", () => {
  it("returns no warnings for valid ADR", () => {
    const dir = mkdtempSync(join(tmpdir(), "spec-test-"));
    try {
      const path = writeTempDoc(join(dir, "docs", "adr"), "ADR-0001-test.md", VALID_ADR);
      expect(validateFrontmatter(path)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("reports missing prd field", () => {
    const dir = mkdtempSync(join(tmpdir(), "spec-test-"));
    try {
      const content = '---\ntitle: "Test"\nadr: ADR-0001\nstatus: Proposed\ndate: 2026-04-14\n---\n';
      const path = writeTempDoc(join(dir, "docs", "adr"), "ADR-0001-test.md", content);
      const warnings = validateFrontmatter(path);
      expect(warnings.some((w) => w.includes("prd"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("reports invalid ADR number", () => {
    const dir = mkdtempSync(join(tmpdir(), "spec-test-"));
    try {
      const content = VALID_ADR.replace("ADR-0001", "ADR-01");
      const path = writeTempDoc(join(dir, "docs", "adr"), "ADR-01-test.md", content);
      const warnings = validateFrontmatter(path);
      expect(warnings.some((w) => w.includes("ADR-NNNN"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("reports invalid ADR status", () => {
    const dir = mkdtempSync(join(tmpdir(), "spec-test-"));
    try {
      const content = VALID_ADR.replace("status: Proposed", "status: Active");
      const path = writeTempDoc(join(dir, "docs", "adr"), "ADR-0001-test.md", content);
      const warnings = validateFrontmatter(path);
      expect(warnings.some((w) => w.includes("Active"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});

// --- Plan validation ---

describe("validate Plan", () => {
  it("returns no warnings for valid plan", () => {
    const dir = mkdtempSync(join(tmpdir(), "spec-test-"));
    try {
      const path = writeTempDoc(join(dir, "docs", "architecture"), "plan-test-feature.md", VALID_PLAN);
      expect(validateFrontmatter(path)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("reports missing author field", () => {
    const dir = mkdtempSync(join(tmpdir(), "spec-test-"));
    try {
      const content = VALID_PLAN.replace('author: "Test User"\n', "");
      const path = writeTempDoc(join(dir, "docs", "architecture"), "plan-test-feature.md", content);
      const warnings = validateFrontmatter(path);
      expect(warnings.some((w) => w.includes("author"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("reports invalid plan status", () => {
    const dir = mkdtempSync(join(tmpdir(), "spec-test-"));
    try {
      const content = VALID_PLAN.replace("status: Draft", "status: Active");
      const path = writeTempDoc(join(dir, "docs", "architecture"), "plan-test-feature.md", content);
      const warnings = validateFrontmatter(path);
      expect(warnings.some((w) => w.includes("Active"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("accepts unquoted YAML dates in plan frontmatter", () => {
    const dir = mkdtempSync(join(tmpdir(), "spec-test-"));
    try {
      const path = writeTempDoc(join(dir, "docs", "architecture"), "plan-test-feature.md", VALID_PLAN);
      const warnings = validateFrontmatter(path);
      expect(warnings.some((w) => w.includes("Field 'date' must be"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("reports a clearer type error for boolean frontmatter values", () => {
    const dir = mkdtempSync(join(tmpdir(), "spec-test-"));
    try {
      const content = VALID_PLAN.replace("status: Draft", "status: true");
      const path = writeTempDoc(join(dir, "docs", "architecture"), "plan-test-feature.md", content);
      const warnings = validateFrontmatter(path);
      expect(warnings.some((w) => w.includes("Field 'status' must be a string, not a boolean"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("reports non-canonical plan prd format", () => {
    const dir = mkdtempSync(join(tmpdir(), "spec-test-"));
    try {
      const content = VALID_PLAN.replace('prd: "PRD-001-test-feature"', 'prd: "PRD-001"');
      const path = writeTempDoc(join(dir, "docs", "architecture"), "plan-test-feature.md", content);
      const warnings = validateFrontmatter(path);
      expect(warnings.some((w) => w.includes("PRD-NNN-descriptive-slug"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});

// --- Required section validation ---

describe("validate required sections", () => {
  it("reports missing required PRD sections", () => {
    const dir = mkdtempSync(join(tmpdir(), "spec-test-"));
    try {
      const path = writeTempDoc(join(dir, "docs", "prd"), "PRD-001-test.md", `${VALID_PRD}\n## 1. Problem & Context\n`);
      const warnings = validateRequiredSections(path);
      expect(warnings.some((w) => w.includes("## 2. Goals & Success Metrics"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("reports missing required ADR sections", () => {
    const dir = mkdtempSync(join(tmpdir(), "spec-test-"));
    try {
      const path = writeTempDoc(join(dir, "docs", "adr"), "ADR-0001-test.md", `${VALID_ADR}\n## Status\nProposed\n`);
      const warnings = validateRequiredSections(path);
      expect(warnings.some((w) => w.includes("## Decision"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("reports missing required plan sections", () => {
    const dir = mkdtempSync(join(tmpdir(), "spec-test-"));
    try {
      const path = writeTempDoc(
        join(dir, "docs", "architecture"),
        "plan-test-feature.md",
        `${VALID_PLAN}\n## Source\n\n## Architecture Overview\n`,
      );
      const warnings = validateRequiredSections(path);
      expect(warnings.some((w) => w.includes("## ADR Index"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("reports missing recommended plan sections as warnings", () => {
    const dir = mkdtempSync(join(tmpdir(), "spec-test-"));
    try {
      const path = writeTempDoc(
        join(dir, "docs", "architecture"),
        "plan-test-feature.md",
        `${VALID_PLAN}\n## Source\n\n## Architecture Overview\n\n## Components\n\n## Implementation Order\n\n## ADR Index\n`,
      );
      const warnings = validateRequiredSections(path);
      expect(warnings.some((w) => w.includes("Missing recommended section: ## Risks and Mitigations"))).toBe(true);
      expect(warnings.some((w) => w.includes("Missing recommended section: ## Open Questions"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("suppresses recommended plan warnings when required sections are missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "spec-test-"));
    try {
      const path = writeTempDoc(
        join(dir, "docs", "architecture"),
        "plan-test-feature.md",
        `${VALID_PLAN}\n## Source\n`,
      );
      const warnings = validateRequiredSections(path);
      expect(warnings.some((w) => w.includes("Missing required section: ## ADR Index"))).toBe(true);
      expect(warnings.some((w) => w.includes("Missing recommended section:"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});

// --- Required table validation ---

describe("validate required tables", () => {
  it("reports missing required PRD table columns", () => {
    const dir = mkdtempSync(join(tmpdir(), "spec-test-"));
    try {
      const path = writeTempDoc(
        join(dir, "docs", "prd"),
        "PRD-001-test.md",
        `${VALID_PRD}\n## 12. Open Questions\n| # | Question | Owner | Due |\n|---|---|---|---|\n| Q1 | Test? | Alice | Soon |\n`,
      );
      const warnings = validateRequiredTables(path);
      expect(warnings.some((w) => w.includes("Open Questions"))).toBe(true);
      expect(warnings.some((w) => w.includes("Status"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("accepts a required table when another table also appears in the same section", () => {
    const dir = mkdtempSync(join(tmpdir(), "spec-test-"));
    try {
      const path = writeTempDoc(
        join(dir, "docs", "prd"),
        "PRD-001-test.md",
        `${VALID_PRD}\n## 9. File Breakdown\n| File | Change type | FR | Description |\n|---|---|---|---|\n| a.ts | Modify | FR-1 | Test |\n\n## 12. Open Questions\n| # | Question | Owner | Due | Status |\n|---|---|---|---|---|\n| Q1 | Test? | Alice | Soon | Open |\n\n| Note | Value |\n|---|---|\n| Summary | Keep |\n\n## 14. Changelog\n| Date | Change | Author |\n|---|---|---|\n| 2026-04-21 | Added test | Pi |\n`,
      );
      expect(validateRequiredTables(path)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("reports missing required plan table columns", () => {
    const dir = mkdtempSync(join(tmpdir(), "spec-test-"));
    try {
      const path = writeTempDoc(
        join(dir, "docs", "architecture"),
        "plan-test-feature.md",
        `${VALID_PLAN}\n## Implementation Order\n| Phase | Component | Estimated Scope |\n|---|---|---|\n| 1 | Parser | M |\n`,
      );
      const warnings = validateRequiredTables(path);
      expect(warnings.some((w) => w.includes("Implementation Order"))).toBe(true);
      expect(warnings.some((w) => w.includes("Dependencies"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});

// --- Non-spec files ---

describe("validateSpecFile", () => {
  it("combines frontmatter, section, and table warnings in one pass", () => {
    const dir = mkdtempSync(join(tmpdir(), "spec-test-"));
    try {
      const path = writeTempDoc(
        join(dir, "docs", "architecture"),
        "plan-test-feature.md",
        '---\ntitle: "Plan"\nprd: "PRD-001"\nstatus: Active\n---\n\n# Plan: Test\n\n## Source\n',
      );
      const warnings = validateSpecFile(path);
      expect(warnings.some((w) => w.includes("Missing required frontmatter field: date"))).toBe(true);
      expect(warnings.some((w) => w.includes("Missing required section: ## ADR Index"))).toBe(true);
      expect(warnings.some((w) => w.includes("Missing required table in section ADR Index"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});

describe("non-spec files", () => {
  it("returns empty warnings for non-spec files", () => {
    const dir = mkdtempSync(join(tmpdir(), "spec-test-"));
    try {
      const path = join(dir, "README.md");
      writeFileSync(path, "# README\n");
      expect(validateFrontmatter(path)).toEqual([]);
      expect(validateSpecFile(path)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});
