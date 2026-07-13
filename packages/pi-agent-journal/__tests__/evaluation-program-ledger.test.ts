import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateEvaluationProgramState } from "../extensions/evaluation-program-state.js";

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
    expect(validateEvaluationProgramState(ledger)).toBe(ledger);
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
      expect(value).not.toMatch(/^\/|^[A-Za-z]:[\\/]|^file:|^\\\\/);
    }
    expect(
      ledger.versions.every((version: { resultDigest: string }) => /^[a-f0-9]{64}$/.test(version.resultDigest)),
    ).toBe(true);
  });

  it.each([
    ["unknown release authority", { releaseAuthorized: true }],
    ["held-out stage before infrastructure acceptance", { currentStage: "version-evaluation" }],
    ["contradictory next stage", { nextStage: "held-out-selection" }],
    ["raw messages", { rawMessages: [{ role: "assistant", content: "private" }] }],
    ["separated tool payload key", { tool_payloads: [{ command: "private" }] }],
    ["generic secret", { secret: "ghp_abcdefghijklmnopqrstuvwxyz1234567890" }],
    ["UNC private path", { privatePath: "\\\\private-host\\Users\\alice\\secret" }],
    ["file URL private path", { privatePath: "file:///Users/alice/secret" }],
  ])("rejects unsafe or unknown metadata: %s", (_label, mutation) => {
    expect(() => validateEvaluationProgramState({ ...structuredClone(ledger), ...mutation })).toThrow();
  });

  it("rejects nested unknown metadata and a skipped acceptance state", () => {
    const nested = structuredClone(ledger);
    nested.historicalEvidenceGuard.rawMessages = [];
    expect(() => validateEvaluationProgramState(nested)).toThrow();

    const skipped = structuredClone(ledger);
    skipped.pendingUserAction = "continue-v4";
    expect(() => validateEvaluationProgramState(skipped)).toThrow();
  });

  it.each([
    [
      "accepted receipt while still hardening",
      (state: typeof ledger) => {
        state.acceptedInfrastructureReceiptDigest = "a".repeat(64);
      },
    ],
    [
      "direct V4 evaluation without a committed continue boundary",
      (state: typeof ledger) => {
        state.acceptedInfrastructureReceiptDigest = "a".repeat(64);
        state.currentStage = "version-evaluation";
      },
    ],
    [
      "passing-result acceptance with only failed versions",
      (state: typeof ledger) => {
        state.acceptedInfrastructureReceiptDigest = "a".repeat(64);
        state.currentStage = "awaiting-result-acceptance";
        state.pendingUserAction = "accept-passing-result";
      },
    ],
    [
      "blocked state with continue authorization",
      (state: typeof ledger) => {
        state.acceptedInfrastructureReceiptDigest = "a".repeat(64);
        state.currentStage = "blocked";
        state.pendingUserAction = "continue-v4";
      },
    ],
    [
      "embedded double-slash private path",
      (state: typeof ledger) => {
        state.reconciledPullRequests[0].branch = "feat//Users/alice/secret";
      },
    ],
    [
      "credential-shaped branch",
      (state: typeof ledger) => {
        state.reconciledPullRequests[0].branch = "xoxb-1234567890-secret";
      },
    ],
  ])("rejects contradictory or unsafe state: %s", (_label, mutate) => {
    const state = structuredClone(ledger);
    mutate(state);
    expect(() => validateEvaluationProgramState(state)).toThrow();
  });

  it("rejects inherited and non-enumerable payload fields", () => {
    const inherited = Object.assign(Object.create({ rawMessages: [{ content: "private" }] }), structuredClone(ledger));
    expect(() => validateEvaluationProgramState(inherited)).toThrow();

    const hidden = structuredClone(ledger);
    Object.defineProperty(hidden, "toolPayload", { value: { command: "private" }, enumerable: false });
    expect(() => validateEvaluationProgramState(hidden)).toThrow();
  });

  it("rejects inherited, hidden, and symbolic fields on array containers", () => {
    const inherited = structuredClone(ledger);
    Object.setPrototypeOf(inherited.versions, Object.assign(Object.create(Array.prototype), { rawMessages: [] }));
    expect(() => validateEvaluationProgramState(inherited)).toThrow();

    const hidden = structuredClone(ledger);
    Object.defineProperty(hidden.versions, "toolPayload", { value: { command: "private" }, enumerable: false });
    expect(() => validateEvaluationProgramState(hidden)).toThrow();

    const symbolic = structuredClone(ledger);
    symbolic.versions[Symbol("toolPayload")] = { command: "private" };
    expect(() => validateEvaluationProgramState(symbolic)).toThrow();

    const accessor = structuredClone(ledger);
    const firstVersion = accessor.versions[0];
    Object.defineProperty(accessor.versions, "0", { enumerable: true, get: () => firstVersion });
    expect(() => validateEvaluationProgramState(accessor)).toThrow();

    const nonWritable = structuredClone(ledger);
    Object.defineProperty(nonWritable.versions, "0", {
      value: nonWritable.versions[0],
      enumerable: true,
      writable: false,
      configurable: true,
    });
    expect(() => validateEvaluationProgramState(nonWritable)).toThrow();

    const nonWritableLength = structuredClone(ledger);
    Object.defineProperty(nonWritableLength.versions, "length", { writable: false });
    expect(() => validateEvaluationProgramState(nonWritableLength)).toThrow();
  });

  it("rejects hidden or accessor-backed required record fields", () => {
    const hiddenRoot = structuredClone(ledger);
    Object.defineProperty(hiddenRoot, "currentStage", { enumerable: false });
    expect(() => validateEvaluationProgramState(hiddenRoot)).toThrow();

    const hiddenNested = structuredClone(ledger);
    Object.defineProperty(hiddenNested.historicalEvidenceGuard, "digest", { enumerable: false });
    expect(() => validateEvaluationProgramState(hiddenNested)).toThrow();

    const accessor = structuredClone(ledger);
    const stage = accessor.currentStage;
    Object.defineProperty(accessor, "currentStage", { enumerable: true, get: () => stage });
    expect(() => validateEvaluationProgramState(accessor)).toThrow();
  });
});
