import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  EVALUATION_SCENARIO_CATEGORIES,
  type EvaluationScenario,
  type EvaluationScenarioCategory,
  evaluateReleaseGate,
  JournalValidationError,
} from "../extensions/domain.js";

const evaluationContract = readFileSync("docs/evaluations/agent-work-journal-v1.md", "utf8");
const heldOutResults = JSON.parse(readFileSync("docs/evaluations/agent-work-journal-v1-results.json", "utf8")) as {
  scenarios: EvaluationScenario[];
  derivedOutcome: unknown;
};

function traces(prefix: string, resumed: boolean[], reads: number[]) {
  return resumed.map((resumedWithoutRestatement, index) => ({
    runId: `${prefix}-${index + 1}`,
    resumedWithoutRestatement,
    repeatedRepositoryReads: reads[index],
  }));
}

function scenario(
  category: EvaluationScenarioCategory,
  journalResumed: boolean[],
  baselineReads: number[],
  journalReads: number[],
) {
  return {
    category,
    baselineTraces: traces(`baseline-${category}`, [false, false, false], baselineReads),
    journalTraces: traces(`journal-${category}`, journalResumed, journalReads),
    equalContextBudget: true,
    equalStatusBudget: true,
  };
}

const passingScenarios = () => [
  scenario("partial-multi-file-investigation", [true, true, false], [6, 5, 7], [6, 5, 6]),
  scenario("material-dependency-change", [true, true, true], [8, 7, 9], [4, 5, 3]),
  scenario("settled-competing-alternative", [false, false, true], [5, 6, 4], [2, 3, 1]),
];

describe("Agent Work Journal evaluation gate", () => {
  it("documents frozen categories, trace evidence, median calculations, and independent thresholds", () => {
    expect(evaluationContract).toContain("Resume a partial multi-file investigation");
    expect(evaluationContract).toContain("Resume after a material dependency changes");
    expect(evaluationContract).toContain("Resume after a competing alternative is settled");
    expect(evaluationContract).toContain("baselineTraces");
    expect(evaluationContract).toContain("journalTraces");
    expect(evaluationContract).toContain("same model/version and reasoning setting");
    expect(evaluationContract).toContain("at least three times");
    expect(evaluationContract).toContain("the passing scenario sets may differ");
  });

  it("derives each metric from per-run traces and medians on different scenario sets", () => {
    expect(evaluateReleaseGate(passingScenarios())).toEqual({
      passed: true,
      resumePasses: 2,
      repeatedReadPasses: 2,
      scenarios: [
        expect.objectContaining({
          category: "partial-multi-file-investigation",
          baselineMedianReads: 6,
          journalMedianReads: 6,
          resumedWithoutRestatement: true,
          reducedRepeatedReads: false,
        }),
        expect.objectContaining({
          category: "material-dependency-change",
          baselineMedianReads: 8,
          journalMedianReads: 4,
          resumedWithoutRestatement: true,
          reducedRepeatedReads: true,
        }),
        expect.objectContaining({
          category: "settled-competing-alternative",
          baselineMedianReads: 5,
          journalMedianReads: 2,
          resumedWithoutRestatement: false,
          reducedRepeatedReads: true,
        }),
      ],
    });
  });

  it("does not count an even-run resumption tie as a scenario pass", () => {
    const values = passingScenarios();
    values[0].baselineTraces.push({
      runId: "baseline-partial-four",
      resumedWithoutRestatement: false,
      repeatedRepositoryReads: 6,
    });
    values[0].journalTraces.push({
      runId: "journal-partial-four",
      resumedWithoutRestatement: false,
      repeatedRepositoryReads: 6,
    });
    const report = evaluateReleaseGate(values);
    expect(report.scenarios[0].resumedWithoutRestatement).toBe(false);
    expect(report.resumePasses).toBe(1);
  });

  it("rejects arbitrary labels even when three unique records would otherwise pass", () => {
    const arbitrary = passingScenarios().map((value, index) => ({ ...value, category: `arbitrary-${index}` }));
    expect(() => evaluateReleaseGate(arbitrary as never)).toThrow(/frozen scenario categories/i);
    expect(EVALUATION_SCENARIO_CATEGORIES).toEqual([
      "partial-multi-file-investigation",
      "material-dependency-change",
      "settled-competing-alternative",
    ]);
  });

  it.each([
    ["missing trace", (values: ReturnType<typeof passingScenarios>) => values[0].journalTraces.pop()],
    [
      "duplicate run id",
      (values: ReturnType<typeof passingScenarios>) => {
        values[0].journalTraces[1].runId = values[0].journalTraces[0].runId;
      },
    ],
    [
      "invalid repeated read count",
      (values: ReturnType<typeof passingScenarios>) => {
        values[0].journalTraces[0].repeatedRepositoryReads = -1;
      },
    ],
    [
      "precomputed boolean",
      (values: ReturnType<typeof passingScenarios>) => Object.assign(values[0], { reducedRepeatedReads: true }),
    ],
  ])("rejects non-reproducible evaluation evidence: %s", (_label, mutate) => {
    const values = passingScenarios();
    mutate(values);
    expect(() => evaluateReleaseGate(values)).toThrow(JournalValidationError);
  });

  it("reproduces the held-out V1 failure and blocks cutover", () => {
    const report = evaluateReleaseGate(heldOutResults.scenarios);
    expect(report).toMatchObject({ passed: false, resumePasses: 3, repeatedReadPasses: 1 });
    expect(heldOutResults.derivedOutcome).toEqual({ passed: false, resumePasses: 3, repeatedReadPasses: 1 });
    expect(evaluationContract).toContain("Overall V1 release gate: **FAIL**");
    expect(evaluationContract).toContain("U7 clean cutover is blocked");
  });

  it("rejects unequal budgets or implementation-exposed scenarios", () => {
    const unequal = passingScenarios();
    unequal[0].equalContextBudget = false;
    expect(() => evaluateReleaseGate(unequal)).toThrow(/equal budgets/i);
    const exposed = passingScenarios();
    Object.assign(exposed[0], { exposedDuringImplementation: true });
    expect(() => evaluateReleaseGate(exposed)).toThrow(/held-out/i);
  });
});
