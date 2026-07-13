import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createGitWorktreeCleanup,
  createGitWorktreePreparer,
  createNodePhaseRunner,
  EvaluationHarnessError,
  type EvaluationPairSpec,
  type PhaseRequest,
  type PhaseResult,
  runEvaluationPair,
} from "../extensions/evaluation-harness.js";
import {
  evaluateV2ReleaseGate,
  V2_BASELINE_ACTIONS,
  V2_EVALUATION_CATEGORIES,
  V2_OWNER_PROTOCOL_DIGEST,
  V2_OWNER_STATUS_FIELDS,
  type V2EvaluationScenario,
} from "../extensions/evaluation-v2.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const TEST_PROMPT = "private held-out prompt placeholder";
const parity = {
  repositorySnapshot: "rev-1",
  promptDigest: createHash("sha256").update(TEST_PROMPT).digest("hex"),
  rubricDigest: "c".repeat(64),
  model: "openai-codex/gpt-5.6-sol",
  reasoning: "high",
  contextBudget: 8000,
  resumeBudget: 4000,
  pausePoint: "pause",
  ownerProtocolDigest: V2_OWNER_PROTOCOL_DIGEST,
};
function spec(): EvaluationPairSpec {
  const trialRoot = mkdtempSync(join(tmpdir(), "agent-journal-v2-harness-"));
  roots.push(trialRoot);
  return { trialRoot, taskId: "task-v2", prompt: TEST_PROMPT, baseline: { ...parity }, journal: { ...parity } };
}
function raw(runId: string, taskId: string, owner = false): string {
  return [
    JSON.stringify({
      type: "evaluation_trace",
      schemaVersion: 2,
      sourceEvaluationVersion: 2,
      runId,
      taskId,
      taskScore: 10,
      resumedWithoutRestatement: true,
      materialTaskCorrect: true,
    }),
    ...(owner
      ? [JSON.stringify({ type: "evaluation_intervention", id: `owner-${runId}`, kind: "status_create", sequence: 1 })]
      : []),
  ].join("\n");
}
const prepareWorkspace = async (
  _condition: "baseline" | "journal",
  targetDir: string,
): Promise<{ workspaceRoot: string; repositorySnapshot: string; promptDigest: string; detached: boolean }> => {
  const workspaceRoot = join(targetDir, "worktree");
  mkdirSync(workspaceRoot, { recursive: true });
  return {
    workspaceRoot,
    repositorySnapshot: parity.repositorySnapshot,
    promptDigest: parity.promptDigest,
    detached: true,
  };
};

function successfulRunner(
  overrides: (request: PhaseRequest, result: PhaseResult) => PhaseResult = (_request, result) => result,
) {
  let process = 0;
  return async (request: PhaseRequest): Promise<PhaseResult> => {
    process += 1;
    const status = V2_OWNER_STATUS_FIELDS.map((field) => `${field.replaceAll("_", " ")}: value`).join("\n");
    if (request.condition === "baseline" && request.phase === "A") {
      writeFileSync(join(request.conditionTrialDir, "generated-status.txt"), status, { mode: 0o600 });
    }
    const base: PhaseResult = {
      processId: `process-${process}`,
      completed: true,
      rawJsonl: [
        raw(request.runId, request.taskId, request.condition === "baseline" && request.phase === "A"),
        ...(request.phase === "A"
          ? [JSON.stringify({ type: "evaluation_pause", pausePoint: request.parity.pausePoint, observed: true })]
          : []),
      ].join("\n"),
      ephemeralTracePaths: [join(request.conditionTrialDir, `phase-${request.phase}.jsonl`)],
      ...(request.condition === "journal" && request.phase === "A"
        ? { autonomousCheckpoint: true, ownerJournalCalls: 0 }
        : {}),
      ...(request.condition === "journal" && request.phase === "B"
        ? { freshProcessResume: true, boundedUntrustedResume: true, resumeCapsuleBytes: 1024 }
        : {}),
      ...(request.condition === "baseline" && request.phase === "A"
        ? {
            generatedStatus: {
              path: join(request.conditionTrialDir, "generated-status.txt"),
              generatedByPhaseA: true,
              byteLength: Buffer.byteLength(status, "utf8"),
              fields: [...V2_OWNER_STATUS_FIELDS],
              actions: [V2_BASELINE_ACTIONS[0]],
              ownerProtocolDigest: V2_OWNER_PROTOCOL_DIGEST,
            },
          }
        : {}),
      ...(request.condition === "journal" && request.phase === "A"
        ? {
            sessionPath: join(request.conditionTrialDir, "session.jsonl"),
            storePath: join(request.conditionTrialDir, "store"),
          }
        : {}),
    };
    return overrides(request, base);
  };
}

describe("V2 two-phase evaluation harness", () => {
  it("creates and verifies a real detached Git worktree receipt", async () => {
    const trialRoot = mkdtempSync(join(tmpdir(), "agent-journal-real-worktree-"));
    roots.push(trialRoot);
    const repositoryRoot = process.cwd();
    const snapshot = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot, encoding: "utf8" }).trim();
    const target = join(trialRoot, "detached");
    const receipt = await createGitWorktreePreparer(repositoryRoot)("baseline", target, {
      ...parity,
      repositorySnapshot: snapshot,
    });
    expect(receipt).toMatchObject({ repositorySnapshot: snapshot, promptDigest: parity.promptDigest, detached: true });
    expect(() => execFileSync("git", ["symbolic-ref", "-q", "HEAD"], { cwd: target, stdio: "ignore" })).toThrow();
    createGitWorktreeCleanup(repositoryRoot)(target);
  }, 30_000);

  it("requires detached worktree receipts derived from the actual trial setup", async () => {
    await expect(runEvaluationPair(spec(), { runPhase: successfulRunner() })).rejects.toThrow(/worktree/i);
    await expect(
      runEvaluationPair(spec(), {
        runPhase: successfulRunner(),
        prepareWorkspace: async (_condition, targetDir) => ({
          workspaceRoot: targetDir,
          repositorySnapshot: "wrong-revision",
          promptDigest: parity.promptDigest,
          detached: true,
        }),
      }),
    ).rejects.toThrow(/snapshot/i);
  });

  it("retains private trial worktrees until explicit independent-verification cleanup", async () => {
    const valueSpec = spec();
    await runEvaluationPair(valueSpec, { prepareWorkspace, runPhase: successfulRunner() });
    expect(existsSync(join(valueSpec.trialRoot, "baseline"))).toBe(true);
    expect(existsSync(join(valueSpec.trialRoot, "journal"))).toBe(true);
  });

  it("runs a synthetic pair as four distinct processes with generated baseline status and journal continuity", async () => {
    const requests: PhaseRequest[] = [];
    const valueSpec = spec();
    const runner = successfulRunner(
      asyncOverride((request, result) => {
        requests.push(structuredClone(request));
        return result;
      }),
    );
    const result = await runEvaluationPair(valueSpec, {
      prepareWorkspace,
      runPhase: runner,
      idGenerator: (() => {
        let i = 0;
        return () => `run-${++i}`;
      })(),
    });
    expect(requests.map((request) => `${request.condition}-${request.phase}`)).toEqual([
      "baseline-A",
      "baseline-B",
      "journal-A",
      "journal-B",
    ]);
    expect(new Set(result.receipt.processIds)).toHaveLength(4);
    expect(requests[1].generatedStatusPath).toContain("generated-status.txt");
    expect(requests[3]).toMatchObject({
      sessionPath: expect.stringContaining("session.jsonl"),
      storePath: expect.stringContaining("store"),
    });
    expect(result.baselineTrace.interventions.map((item) => item.kind)).toContain("status_create");
    expect(result.journalTrace.interventions).toHaveLength(0);
    expect(JSON.stringify(result)).not.toContain(valueSpec.trialRoot);
  });

  it.each([
    ["snapshot", "repositorySnapshot", "rev-2"],
    ["prompt", "promptDigest", "other"],
    ["model", "model", "other"],
    ["reasoning", "reasoning", "low"],
    ["context budget", "contextBudget", 1],
    ["resume budget", "resumeBudget", 1],
    ["pause point", "pausePoint", "other"],
    ["owner protocol", "ownerProtocolDigest", "other"],
  ])("rejects condition parity mismatch: %s", async (_name, key, value) => {
    const valueSpec = spec();
    Object.assign(valueSpec.journal, { [key]: value });
    await expect(runEvaluationPair(valueSpec, { prepareWorkspace, runPhase: successfulRunner() })).rejects.toThrow(
      /parity/i,
    );
  });

  it("rejects prewritten baseline status and journal capsules", async () => {
    const baseline = spec();
    baseline.prewrittenBaselineStatusPath = join(baseline.trialRoot, "status");
    await expect(runEvaluationPair(baseline, { prepareWorkspace, runPhase: successfulRunner() })).rejects.toThrow(
      /prewritten baseline/i,
    );
    const journal = spec();
    journal.prewrittenJournalCapsulePath = join(journal.trialRoot, "capsule");
    await expect(runEvaluationPair(journal, { prepareWorkspace, runPhase: successfulRunner() })).rejects.toThrow(
      /prewritten journal/i,
    );
  });

  it.each([
    ["same process", successfulRunner((request, result) => ({ ...result, processId: `same-${request.condition}` }))],
    [
      "missing continuity",
      successfulRunner((request, result) =>
        request.condition === "journal" && request.phase === "A" ? { ...result, sessionPath: undefined } : result,
      ),
    ],
    [
      "incomplete phase",
      successfulRunner((request, result) => (request.phase === "B" ? { ...result, completed: false } : result)),
    ],
    [
      "escaped trace",
      successfulRunner((_request, result) => ({ ...result, ephemeralTracePaths: ["/tmp/outside.jsonl"] })),
    ],
  ])("fails closed for %s", async (_name, runner) => {
    await expect(runEvaluationPair(spec(), { prepareWorkspace, runPhase: runner })).rejects.toThrow(
      EvaluationHarnessError,
    );
  });

  it("rejects colliding run IDs", async () => {
    await expect(
      runEvaluationPair(spec(), { prepareWorkspace, runPhase: successfulRunner(), idGenerator: () => "same-run" }),
    ).rejects.toThrow(/run IDs/i);
  });

  it("requires autonomous phase-A checkpointing and a bounded untrusted fresh-process phase-B resume", async () => {
    const invalid = [
      ["owner journal call", { ownerJournalCalls: 1 }],
      ["missing autonomous checkpoint", { autonomousCheckpoint: false }],
      ["reused resume process", { freshProcessResume: false }],
      ["untrusted label missing", { boundedUntrustedResume: false }],
      ["oversized resume capsule", { resumeCapsuleBytes: 4001 }],
    ] as const;
    for (const [label, patch] of invalid) {
      const runner = successfulRunner((request, result) =>
        request.condition === "journal" &&
        ((request.phase === "A" && "ownerJournalCalls" in patch) ||
          (request.phase === "A" && "autonomousCheckpoint" in patch) ||
          (request.phase === "B" && !("ownerJournalCalls" in patch) && !("autonomousCheckpoint" in patch)))
          ? Object.assign(result, patch)
          : result,
      );
      await expect(runEvaluationPair(spec(), { prepareWorkspace, runPhase: runner }), label).rejects.toThrow(
        EvaluationHarnessError,
      );
    }
  });

  it("fails closed for missed, late, false, non-durable, or rewrite-based material safety", async () => {
    const safeReceipt = {
      caseId: "case-safe",
      noticePersistedAcrossRestart: true,
      staleSupportWithheld: true,
      detectionSequence: 2,
      unsafeContinuationSequence: 3,
      resolutionAppended: true,
      noticeHistoryUnchanged: true,
      entryHistoryUnchanged: true,
      falsePositive: false,
      safetyInterventionKind: "material_stale_resolution",
    };
    const invalid = [
      ["missed", { detectionSequence: null }],
      ["late", { detectionSequence: 4 }],
      ["false", { falsePositive: true }],
      ["lost notice", { noticePersistedAcrossRestart: false }],
      ["stale support leaked", { staleSupportWithheld: false }],
      ["rewritten history", { noticeHistoryUnchanged: false }],
      ["not append only", { resolutionAppended: false }],
      ["miscounted safety", { safetyInterventionKind: "status_correction" }],
    ] as const;
    for (const [label, patch] of invalid) {
      const runner = successfulRunner((request, result) =>
        request.condition === "journal" && request.phase === "B"
          ? Object.assign(result, { materialSafety: { ...safeReceipt, ...patch } })
          : result,
      );
      await expect(runEvaluationPair(spec(), { prepareWorkspace, runPhase: runner }), label).rejects.toThrow(
        EvaluationHarnessError,
      );
    }
  });

  it("accepts detection-before-continuation, durable withholding, and append-only material resolution", async () => {
    const runner = successfulRunner((request, result) =>
      request.condition === "journal" && request.phase === "B"
        ? Object.assign(result, {
            rawJsonl: [
              result.rawJsonl,
              JSON.stringify({
                type: "evaluation_intervention",
                id: "safety-safe",
                kind: "material_stale_resolution",
                sequence: 1,
              }),
              JSON.stringify({
                type: "evaluation_material_case",
                id: "case-safe",
                sequence: 2,
                detectedBeforeContinuation: true,
                resolvedAppendOnly: true,
                falsePositive: false,
              }),
            ].join("\n"),
            materialSafety: {
              caseId: "case-safe",
              noticePersistedAcrossRestart: true,
              staleSupportWithheld: true,
              detectionSequence: 2,
              unsafeContinuationSequence: 3,
              resolutionAppended: true,
              noticeHistoryUnchanged: true,
              entryHistoryUnchanged: true,
              falsePositive: false,
              safetyInterventionKind: "material_stale_resolution",
            },
          })
        : result,
    );
    const result = await runEvaluationPair(spec(), { prepareWorkspace, runPhase: runner });
    expect(result.receipt).toMatchObject({ autonomousCheckpoint: true, boundedUntrustedResume: true });
  });

  it("preflights parser, two-phase harness, safety taxonomy, provenance, and scorer end to end", async () => {
    const scenarios: V2EvaluationScenario[] = [];
    for (const [categoryIndex, category] of V2_EVALUATION_CATEGORIES.entries()) {
      const baselineTraces = [];
      const journalTraces = [];
      for (let runIndex = 0; runIndex < 3; runIndex += 1) {
        const valueSpec = spec();
        valueSpec.taskId = `synthetic-${categoryIndex}`;
        const runner = successfulRunner((request, result) => {
          if (request.condition !== "journal" || request.phase !== "B") return result;
          const events = result.rawJsonl.split("\n");
          events.push(
            JSON.stringify({
              type: "evaluation_intervention",
              id: `safety-${categoryIndex}-${runIndex}`,
              kind: "material_stale_resolution",
              sequence: 1,
            }),
            JSON.stringify({
              type: "evaluation_material_case",
              id: `material-${categoryIndex}`,
              sequence: 2,
              detectedBeforeContinuation: true,
              resolvedAppendOnly: true,
              falsePositive: false,
            }),
          );
          return {
            ...result,
            rawJsonl: events.join("\n"),
            materialSafety: {
              caseId: `material-${categoryIndex}`,
              noticePersistedAcrossRestart: true,
              staleSupportWithheld: true,
              detectionSequence: 1,
              unsafeContinuationSequence: 2,
              resolutionAppended: true,
              noticeHistoryUnchanged: true,
              entryHistoryUnchanged: true,
              falsePositive: false,
              safetyInterventionKind: "material_stale_resolution",
            },
          };
        });
        const pair = await runEvaluationPair(valueSpec, { prepareWorkspace, runPhase: runner });
        baselineTraces.push(pair.baselineTrace);
        journalTraces.push(pair.journalTrace);
        expect(pair.receipt).toMatchObject({
          autonomousCheckpoint: true,
          boundedUntrustedResume: true,
          materialSafetyVerified: true,
        });
        expect(pair.journalTrace).toMatchObject({ avoidableMaintenanceCount: 0, necessarySafetyCount: 1 });
      }
      scenarios.push({
        schemaVersion: 2,
        category,
        taskId: `synthetic-${categoryIndex}`,
        selectedAfterInfrastructureFreeze: true,
        exposedDuringImplementation: false,
        baselineParity: { ...parity },
        journalParity: { ...parity },
        expectedMaterialCaseIds: [`material-${categoryIndex}`],
        baselineTraces,
        journalTraces,
      });
    }
    expect(evaluateV2ReleaseGate(scenarios)).toMatchObject({
      passed: true,
      maintenanceImprovementScenarios: 3,
      materialSafetyPassed: true,
    });
  });

  it("runs the production journal runtime and store across fresh phase processes", async () => {
    const buildRoot = mkdtempSync(join(process.cwd(), "packages/pi-agent-journal/.evaluation-build-"));
    roots.push(buildRoot);
    execFileSync("npx", ["tsc", "--project", "packages/pi-agent-journal/tsconfig.mcp.json", "--outDir", buildRoot], {
      cwd: process.cwd(),
      stdio: "ignore",
    });
    const executable = join(buildRoot, "extensions/evaluation-production-fixture.js");
    const result = await runEvaluationPair(spec(), {
      prepareWorkspace,
      runPhase: createNodePhaseRunner(executable),
    });
    expect(result.receipt).toMatchObject({
      autonomousCheckpoint: true,
      boundedUntrustedResume: true,
      materialSafetyVerified: true,
    });
    expect(result.journalTrace.materialCases).toEqual([
      expect.objectContaining({
        id: "production-material-case",
        detectedBeforeContinuation: true,
        resolvedAppendOnly: true,
      }),
    ]);
    expect(result.journalTrace.provenance.harnessReceipt.workspaceReceiptDigest).toBe(
      result.receipt.workspaceReceiptDigest,
    );
  }, 30_000);

  it("uses a real fresh process per phase with the repository fake Pi fixture", async () => {
    const valueSpec = spec();
    const executable = join(process.cwd(), "packages/pi-agent-journal/__tests__/fixtures/evaluation/fake-pi.mjs");
    const result = await runEvaluationPair(valueSpec, {
      prepareWorkspace,
      runPhase: createNodePhaseRunner(executable),
    });
    expect(new Set(result.receipt.processIds)).toHaveLength(4);
    expect(result.receipt.completedPhases).toEqual(["baseline-A", "baseline-B", "journal-A", "journal-B"]);
  });
});

function asyncOverride(
  fn: (request: PhaseRequest, result: PhaseResult) => PhaseResult,
): (request: PhaseRequest, result: PhaseResult) => PhaseResult {
  return fn;
}
