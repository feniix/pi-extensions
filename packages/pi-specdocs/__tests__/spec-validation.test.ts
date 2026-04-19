/**
 * Unit tests for specdocs validation module.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isAdr, isPrd, parseFrontmatter, validateFrontmatter } from "../extensions/index.js";

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

// --- Non-spec files ---

describe("non-spec files", () => {
  it("returns empty warnings for non-spec files", () => {
    const dir = mkdtempSync(join(tmpdir(), "spec-test-"));
    try {
      const path = join(dir, "README.md");
      writeFileSync(path, "# README\n");
      expect(validateFrontmatter(path)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});
