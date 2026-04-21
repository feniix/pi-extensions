import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { afterEach, describe, expect, it } from "vitest";
import { validateSpecFile } from "../extensions/index.js";

const runBenchmarks = process.env.PI_SPECDOCS_BENCH === "1";

function createPrd(index: number): string {
  const number = String(index).padStart(3, "0");
  return `---
title: "PRD ${number}"
prd: PRD-${number}
status: Draft
owner: Alice
date: 2026-04-21
issue: N/A
version: 1.0
---

# PRD ${number}

## 1. Problem & Context
Body

## 2. Goals & Success Metrics
Body

## 3. Users & Use Cases
Body

## 4. Scope
Body

## 5. Functional Requirements
Body

## 6. Non-Functional Requirements
Body

## 7. Risks & Assumptions
Body

## 8. Design Decisions
Body

## 9. File Breakdown
| File | Change type | FR | Description |
| --- | --- | --- | --- |
| file.ts | Modify | FR-1 | Test |

## 10. Dependencies & Constraints
Body

## 11. Rollout Plan
Body

## 12. Open Questions
| # | Question | Owner | Due | Status |
| --- | --- | --- | --- | --- |
| Q1 | Test? | Alice | Soon | Open |

## 13. Related
Body

## 14. Changelog
| Date | Change | Author |
| --- | --- | --- |
| 2026-04-21 | Added benchmark fixture | Pi |
`;
}

function createAdr(index: number): string {
  const number = String(index).padStart(4, "0");
  return `---
title: "ADR ${number}"
adr: ADR-${number}
status: Proposed
date: 2026-04-21
prd: "PRD-001-benchmark"
---

# ADR ${number}

## Status
Proposed

## Date
2026-04-21

## Requirement Source
Body

## Context
Body

## Decision Drivers
Body

## Considered Options
Body

## Decision
Body

## Consequences
Body

## Related
Body
`;
}

function createPlan(index: number): string {
  return `---
title: "Plan ${index}"
prd: "PRD-001-benchmark"
date: 2026-04-21
author: "Pi"
status: Draft
---

# Plan ${index}

## Source
Body

## Architecture Overview
Body

## Components
Body

## Implementation Order
| Phase | Component | Dependencies | Estimated Scope |
| --- | --- | --- | --- |
| 1 | Parser | None | M |

## Risks and Mitigations
Body

## Open Questions
Body

## ADR Index
| ADR | Title | Status |
| --- | --- | --- |
| ADR-0001 | Example | Accepted |
`;
}

function createWorkspaceFixture(base: string): { singleFile: string; allFiles: string[] } {
  const prdDir = join(base, "docs", "prd");
  const adrDir = join(base, "docs", "adr");
  const planDir = join(base, "docs", "architecture");
  mkdirSync(prdDir, { recursive: true });
  mkdirSync(adrDir, { recursive: true });
  mkdirSync(planDir, { recursive: true });

  const allFiles: string[] = [];

  for (let i = 1; i <= 10; i++) {
    const path = join(prdDir, `PRD-${String(i).padStart(3, "0")}-benchmark-${i}.md`);
    writeFileSync(path, createPrd(i));
    allFiles.push(path);
  }

  for (let i = 1; i <= 10; i++) {
    const path = join(adrDir, `ADR-${String(i).padStart(4, "0")}-benchmark-${i}.md`);
    writeFileSync(path, createAdr(i));
    allFiles.push(path);
  }

  for (let i = 1; i <= 5; i++) {
    const path = join(planDir, `plan-benchmark-${i}.md`);
    writeFileSync(path, createPlan(i));
    allFiles.push(path);
  }

  return { singleFile: allFiles[0] as string, allFiles };
}

describe("pi-specdocs performance", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  it.skipIf(!runBenchmarks)("measures single-file and workspace validation targets", () => {
    const base = mkdtempSync(join(tmpdir(), "pi-specdocs-bench-"));
    tempDirs.push(base);
    const { singleFile, allFiles } = createWorkspaceFixture(base);

    // This first single-file measurement intentionally includes cold per-file
    // costs (read + initial parse for that file), making it a conservative
    // ceiling check rather than a pure steady-state number.
    const singleStart = performance.now();
    validateSpecFile(singleFile);
    const singleDurationMs = performance.now() - singleStart;

    const workspaceStart = performance.now();
    for (const file of allFiles) {
      validateSpecFile(file);
    }
    const workspaceDurationMs = performance.now() - workspaceStart;

    console.log(
      `[specdocs-bench] single_file_ms=${singleDurationMs.toFixed(2)} workspace_ms=${workspaceDurationMs.toFixed(2)} files=${allFiles.length}`,
    );

    expect(singleDurationMs).toBeLessThan(250);
    expect(workspaceDurationMs).toBeLessThan(2000);
  });
});
