import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ledgerPath = "docs/evaluations/agent-work-journal-evaluation-program-state.json";
const v1 = JSON.parse(readFileSync("docs/evaluations/agent-work-journal-v1-results.json", "utf8"));
const v2 = JSON.parse(readFileSync("docs/evaluations/agent-work-journal-v2-results.json", "utf8"));
const v3 = JSON.parse(readFileSync("docs/evaluations/agent-work-journal-v3-results.json", "utf8"));
const ledger = JSON.parse(readFileSync(ledgerPath, "utf8"));

const sha256 = (path: string): string => createHash("sha256").update(readFileSync(path)).digest("hex");

function stringsIn(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(stringsIn);
  if (value && typeof value === "object")
    return Object.entries(value).flatMap(([key, item]) => [key, ...stringsIn(item)]);
  return [];
}

describe("Agent Journal evaluation program ledger", () => {
  it("records the reconciled program state without skipping an acceptance pause", () => {
    expect(ledger).toMatchObject({
      schemaVersion: 1,
      currentStage: "infrastructure-hardening",
      latestCompletedVersion: 3,
      acceptedInfrastructureReceiptDigest: null,
      pendingUserAction: "none",
      predecessorCutoverPerformed: false,
      historicalEvidenceGuard: {
        path: "docs/evaluations/agent-work-journal-historical-guard.json",
        digest: sha256("docs/evaluations/agent-work-journal-historical-guard.json"),
      },
    });
    expect(ledger.reconciledPullRequests).toEqual([
      {
        prNumber: 123,
        branch: "feat/agent-journal-v3-evaluation",
        mergeCommit: "b70896bfd75757c54eca2908632c7cfa42703556",
        ciRunId: 29257513519,
        ciConclusion: "success",
      },
      {
        prNumber: 124,
        branch: "feat/agent-journal-historical-guard",
        mergeCommit: "c42c04702fca2a62119d819600578c4a195c076d",
        ciRunId: 29259743229,
        ciConclusion: "success",
      },
    ]);
  });

  it("derives historical task and run identifiers from terminal evidence", () => {
    const v1RunIds = v1.scenarios.flatMap((scenario: Record<string, Array<{ runId: string }>>) => [
      ...scenario.baselineTraces.map((trace) => trace.runId),
      ...scenario.journalTraces.map((trace) => trace.runId),
    ]);
    expect(ledger.versions).toEqual([
      {
        version: 1,
        terminalState: "FAIL",
        failureStage: "frozen-all-of-gate",
        taskIds: [],
        runIds: v1RunIds,
        resultDigest: sha256("docs/evaluations/agent-work-journal-v1-results.json"),
        cleanupState: "private-traces-not-committed",
      },
      {
        version: 2,
        terminalState: v2.status,
        failureStage: v2.failureStage,
        taskIds: v2.selectedTasks.map((task: { taskId: string }) => task.taskId),
        runIds: v2.excludedAttemptRunIds,
        resultDigest: sha256("docs/evaluations/agent-work-journal-v2-results.json"),
        cleanupState: "verified-and-deleted",
      },
      {
        version: 3,
        terminalState: v3.status,
        failureStage: v3.failureStage,
        taskIds: v3.selectedTaskIds,
        runIds: v3.runIds,
        resultDigest: sha256("docs/evaluations/agent-work-journal-v3-results.json"),
        cleanupState: "synthetic-evidence-deleted",
      },
    ]);
  });

  it("contains only safe state metadata", () => {
    const encoded = JSON.stringify(ledger);
    expect(encoded).not.toMatch(
      /prompt|fixture|rubric|grader|mutation|credential|toolPayload|modelMessage|reasoning|tracePayload/i,
    );
    for (const value of stringsIn(ledger)) {
      expect(value).not.toMatch(/^\/(?!\/)|^[A-Za-z]:[\\/]/);
    }
    expect(
      ledger.versions.every((version: { resultDigest: string }) => /^[a-f0-9]{64}$/.test(version.resultDigest)),
    ).toBe(true);
  });
});
