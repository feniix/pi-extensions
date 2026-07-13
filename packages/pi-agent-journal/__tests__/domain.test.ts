import { describe, expect, it } from "vitest";
import {
  type EvaluationScenarioCategory,
  evaluateReleaseGate,
  JournalValidationError,
  normalizeEntryInput,
  validateCheckpointShape,
} from "../extensions/domain.js";

const scenario = (category: EvaluationScenarioCategory, resume: boolean, reads: boolean) => ({
  category,
  baselineTraces: [1, 2, 3].map((run) => ({
    runId: `baseline-${category}-${run}`,
    resumedWithoutRestatement: false,
    repeatedRepositoryReads: 3,
  })),
  journalTraces: [1, 2, 3].map((run) => ({
    runId: `journal-${category}-${run}`,
    resumedWithoutRestatement: resume,
    repeatedRepositoryReads: reads ? 2 : 3,
  })),
  equalContextBudget: true,
  equalStatusBudget: true,
});

describe("journal domain", () => {
  it.each([
    "observation",
    "evidence",
    "assumption",
    "decision",
    "rejected_alternative",
    "validation",
    "next_action",
  ] as const)("accepts %s entries", (type) => {
    const entry = normalizeEntryInput(
      { type, content: " durable state ", relationships: [] },
      { id: "entry-1", timestamp: "2026-07-12T00:00:00.000Z" },
    );
    expect(entry).toMatchObject({ id: "entry-1", type, content: "durable state" });
  });

  it("rejects malformed and self relationships", () => {
    expect(() =>
      normalizeEntryInput(
        {
          type: "decision",
          content: "x",
          relationships: [{ type: "supersedes", targetEntryId: "self" }],
        },
        { id: "self", timestamp: "2026-07-12T00:00:00.000Z" },
      ),
    ).toThrow(JournalValidationError);
  });

  it("rejects checkpoints whose records are malformed", () => {
    expect(() => validateCheckpointShape({ id: "", objective: "x" })).toThrow(JournalValidationError);
  });

  it("bounds entry identifiers, content, and dependency shapes", () => {
    expect(() => normalizeEntryInput({ id: "x".repeat(257), type: "evidence", content: "proof" })).toThrow(
      /id.*byte limit/i,
    );
    expect(() => normalizeEntryInput({ type: "evidence", content: "x".repeat(20_001) })).toThrow(/byte limit/i);
    expect(() =>
      normalizeEntryInput({
        type: "evidence",
        content: "proof",
        dependencies: [{ kind: "file", path: "a" } as never],
      }),
    ).toThrow(/dependency/i);
  });

  it("gates each evaluation metric independently", () => {
    const report = evaluateReleaseGate([
      scenario("partial-multi-file-investigation", true, false),
      scenario("material-dependency-change", true, true),
      scenario("settled-competing-alternative", false, true),
    ]);
    expect(report).toMatchObject({ passed: true, resumePasses: 2, repeatedReadPasses: 2 });
  });

  it("rejects incomplete or implementation-exposed evaluations", () => {
    expect(() =>
      evaluateReleaseGate([
        {
          ...scenario("partial-multi-file-investigation", true, true),
          exposedDuringImplementation: true,
        },
      ]),
    ).toThrow(/three held-out/i);
  });
});
