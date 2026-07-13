import { execFile, execFileSync, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { type NormalizedV2Trace, normalizeEvaluationJsonl } from "./evaluation-trace.js";
import {
  computeV2HarnessReceiptDigest,
  computeV2ParityDigest,
  V2_BASELINE_ACTIONS,
  V2_OWNER_PROTOCOL_DIGEST,
  V2_OWNER_STATUS_FIELDS,
  type V2ParityReceipt,
} from "./evaluation-v2.js";

export type EvaluationCondition = "baseline" | "journal";
export type EvaluationPhase = "A" | "B";

export interface EvaluationPairSpec {
  trialRoot: string;
  taskId: string;
  prompt: string;
  baseline: V2ParityReceipt;
  journal: V2ParityReceipt;
  prewrittenBaselineStatusPath?: string;
  prewrittenJournalCapsulePath?: string;
}

export interface WorkspaceReceipt {
  workspaceRoot: string;
  repositorySnapshot: string;
  promptDigest: string;
  detached: boolean;
}

export interface PhaseRequest {
  condition: EvaluationCondition;
  phase: EvaluationPhase;
  conditionTrialDir: string;
  workspaceRoot: string;
  taskId: string;
  prompt: string;
  runId: string;
  parity: V2ParityReceipt;
  generatedStatusPath?: string;
  sessionPath?: string;
  storePath?: string;
}

export interface MaterialSafetyReceipt {
  caseId: string;
  noticePersistedAcrossRestart: boolean;
  staleSupportWithheld: boolean;
  detectionSequence: number | null;
  unsafeContinuationSequence: number | null;
  resolutionAppended: boolean;
  noticeHistoryUnchanged: boolean;
  entryHistoryUnchanged: boolean;
  falsePositive: boolean;
  safetyInterventionKind: "material_stale_resolution" | "material_conflict_resolution";
}

export interface PhaseResult {
  processId: string;
  completed: boolean;
  rawJsonl: string;
  generatedStatus?: {
    path: string;
    generatedByPhaseA: boolean;
    byteLength: number;
    fields: string[];
    actions: string[];
    ownerProtocolDigest: string;
  };
  sessionPath?: string;
  storePath?: string;
  ephemeralTracePaths: string[];
  autonomousCheckpoint?: boolean;
  ownerJournalCalls?: number;
  freshProcessResume?: boolean;
  boundedUntrustedResume?: boolean;
  resumeCapsuleBytes?: number;
  materialSafety?: MaterialSafetyReceipt;
}

export interface EvaluationPairResult {
  baselineTrace: NormalizedV2Trace;
  journalTrace: NormalizedV2Trace;
  receipt: {
    schemaVersion: 2;
    taskId: string;
    runIds: [string, string];
    processIds: string[];
    completedPhases: string[];
    parityDigest: string;
    baselineStatusGeneratedByPhaseA: true;
    journalContinuityFromPhaseA: true;
    autonomousCheckpoint: true;
    boundedUntrustedResume: true;
    materialSafetyVerified: boolean;
    workspaceReceiptDigest: string;
    privateRawTraceRelativePaths: string[];
  };
}

const execFileAsync = promisify(execFile);

export class EvaluationHarnessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvaluationHarnessError";
  }
}

function inside(path: string, root: string): boolean {
  const local = relative(resolve(root), resolve(path));
  return local !== "" && local !== ".." && !local.startsWith(`..${sep}`) && !isAbsolute(local);
}

function assertPhase(result: PhaseResult, request: PhaseRequest): void {
  if (!result.completed) throw new EvaluationHarnessError(`${request.condition} phase ${request.phase} incomplete`);
  if (typeof result.processId !== "string" || !result.processId)
    throw new EvaluationHarnessError("phase process ID missing");
  if (!Array.isArray(result.ephemeralTracePaths)) throw new EvaluationHarnessError("ephemeral trace receipt missing");
  if (result.ephemeralTracePaths.some((path) => !inside(path, request.conditionTrialDir))) {
    throw new EvaluationHarnessError("ephemeral trace escaped private trial directory");
  }
  if (request.condition === "journal" && request.phase === "A") {
    if (result.autonomousCheckpoint !== true || result.ownerJournalCalls !== 0) {
      throw new EvaluationHarnessError("journal phase A requires autonomous checkpointing without owner journal calls");
    }
  }
  if (request.condition === "journal" && request.phase === "B") {
    if (
      result.freshProcessResume !== true ||
      result.boundedUntrustedResume !== true ||
      !Number.isInteger(result.resumeCapsuleBytes) ||
      (result.resumeCapsuleBytes as number) < 1 ||
      (result.resumeCapsuleBytes as number) > 4000
    ) {
      throw new EvaluationHarnessError("journal phase B requires a bounded untrusted fresh-process resume");
    }
    if (result.materialSafety) assertMaterialSafety(result.materialSafety);
  }
}

function assertObservedPause(result: PhaseResult, expected: string): void {
  const observed = result.rawJsonl
    .split(/\r?\n/)
    .filter(Boolean)
    .some((line) => {
      try {
        const event = JSON.parse(line) as Record<string, unknown>;
        return event.type === "evaluation_pause" && event.pausePoint === expected && event.observed === true;
      } catch {
        return false;
      }
    });
  if (!observed) throw new EvaluationHarnessError("phase A did not observe the frozen pause marker");
}

function mergePhaseJsonl(phaseA: string, phaseB: string): string {
  const a = phaseA.split(/\r?\n/).filter(Boolean);
  const b = phaseB.split(/\r?\n/).filter(Boolean);
  if (a.length === 0 || b.length === 0) throw new EvaluationHarnessError("both phase traces require headers");
  return [b[0], ...a.slice(1), ...b.slice(1)].join("\n");
}

function assertMaterialSafety(receipt: MaterialSafetyReceipt): void {
  if (
    !receipt.caseId ||
    receipt.noticePersistedAcrossRestart !== true ||
    receipt.staleSupportWithheld !== true ||
    receipt.resolutionAppended !== true ||
    receipt.noticeHistoryUnchanged !== true ||
    receipt.entryHistoryUnchanged !== true ||
    receipt.falsePositive !== false ||
    receipt.detectionSequence === null ||
    !Number.isInteger(receipt.detectionSequence) ||
    (receipt.unsafeContinuationSequence !== null &&
      (!Number.isInteger(receipt.unsafeContinuationSequence) ||
        receipt.detectionSequence >= receipt.unsafeContinuationSequence)) ||
    (receipt.safetyInterventionKind !== "material_stale_resolution" &&
      receipt.safetyInterventionKind !== "material_conflict_resolution")
  ) {
    throw new EvaluationHarnessError("material safety receipt failed closed");
  }
}

export async function runEvaluationPair(
  spec: EvaluationPairSpec,
  deps: {
    runPhase: (request: PhaseRequest) => Promise<PhaseResult>;
    prepareWorkspace?: (
      condition: EvaluationCondition,
      targetDir: string,
      expected: V2ParityReceipt,
    ) => Promise<WorkspaceReceipt>;
    idGenerator?: () => string;
  },
): Promise<EvaluationPairResult> {
  if (spec.prewrittenBaselineStatusPath) throw new EvaluationHarnessError("prewritten baseline status is forbidden");
  if (spec.prewrittenJournalCapsulePath) throw new EvaluationHarnessError("prewritten journal capsule is forbidden");
  if (JSON.stringify(spec.baseline) !== JSON.stringify(spec.journal)) {
    throw new EvaluationHarnessError("baseline and journal parity receipts differ");
  }
  const actualPromptDigest = createHash("sha256").update(spec.prompt).digest("hex");
  if (actualPromptDigest !== spec.baseline.promptDigest) {
    throw new EvaluationHarnessError("actual prompt does not match the frozen prompt digest");
  }
  const generateId = deps.idGenerator ?? randomUUID;
  const baselineRunId = generateId();
  const journalRunId = generateId();
  if (!baselineRunId || !journalRunId || baselineRunId === journalRunId) {
    throw new EvaluationHarnessError("condition run IDs must be unique");
  }
  if (!deps.prepareWorkspace) throw new EvaluationHarnessError("detached worktree preparation is required");
  const root = resolve(spec.trialRoot);
  const baselineDir = resolve(root, "baseline");
  const journalDir = resolve(root, "journal");
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const baselineWorkspace = await deps.prepareWorkspace("baseline", baselineDir, spec.baseline);
  const journalWorkspace = await deps.prepareWorkspace("journal", journalDir, spec.journal);
  for (const [condition, receipt, expected] of [
    ["baseline", baselineWorkspace, spec.baseline],
    ["journal", journalWorkspace, spec.journal],
  ] as const) {
    if (!receipt.detached) throw new EvaluationHarnessError(`${condition} workspace must be a detached worktree`);
    if (receipt.repositorySnapshot !== expected.repositorySnapshot) {
      throw new EvaluationHarnessError(`${condition} workspace snapshot does not match parity receipt`);
    }
    if (receipt.promptDigest !== expected.promptDigest) {
      throw new EvaluationHarnessError(`${condition} prompt digest does not match parity receipt`);
    }
    if (
      !inside(receipt.workspaceRoot, root) &&
      resolve(receipt.workspaceRoot) !== resolve(condition === "baseline" ? baselineDir : journalDir)
    ) {
      throw new EvaluationHarnessError(`${condition} workspace escaped the private trial root`);
    }
  }
  const requests: PhaseRequest[] = [];
  const results: PhaseResult[] = [];
  const invoke = async (request: PhaseRequest): Promise<PhaseResult> => {
    requests.push(request);
    const result = await deps.runPhase(request);
    assertPhase(result, request);
    results.push(result);
    return result;
  };
  const baselineARequest: PhaseRequest = {
    condition: "baseline",
    phase: "A",
    conditionTrialDir: baselineDir,
    workspaceRoot: baselineWorkspace.workspaceRoot,
    taskId: spec.taskId,
    prompt: spec.prompt,
    runId: baselineRunId,
    parity: spec.baseline,
  };
  const baselineA = await invoke(baselineARequest);
  assertObservedPause(baselineA, spec.baseline.pausePoint);
  if (!baselineA.generatedStatus?.generatedByPhaseA || !inside(baselineA.generatedStatus.path, baselineDir)) {
    throw new EvaluationHarnessError("baseline status must be generated by phase A inside the trial");
  }
  let generatedStatus: string;
  try {
    generatedStatus = readFileSync(baselineA.generatedStatus.path, "utf8");
  } catch {
    throw new EvaluationHarnessError("baseline status artifact cannot be read");
  }
  const actualFields = generatedStatus
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => line.split(":", 1)[0].trim().toLowerCase().replaceAll(" ", "_"));
  if (
    !Number.isInteger(baselineA.generatedStatus.byteLength) ||
    baselineA.generatedStatus.byteLength !== Buffer.byteLength(generatedStatus, "utf8") ||
    baselineA.generatedStatus.byteLength < 1 ||
    baselineA.generatedStatus.byteLength > 4000 ||
    JSON.stringify(actualFields) !== JSON.stringify(V2_OWNER_STATUS_FIELDS) ||
    JSON.stringify(baselineA.generatedStatus.fields) !== JSON.stringify(V2_OWNER_STATUS_FIELDS) ||
    baselineA.generatedStatus.actions.some((action) => !V2_BASELINE_ACTIONS.includes(action as never)) ||
    baselineA.generatedStatus.actions.length === 0 ||
    baselineA.generatedStatus.ownerProtocolDigest !== V2_OWNER_PROTOCOL_DIGEST
  ) {
    throw new EvaluationHarnessError("baseline status receipt violates the frozen owner protocol");
  }
  const baselineB = await invoke({
    ...baselineARequest,
    phase: "B",
    generatedStatusPath: baselineA.generatedStatus.path,
  });
  if (baselineA.processId === baselineB.processId) {
    throw new EvaluationHarnessError("baseline phase B must use a fresh process");
  }

  const journalARequest: PhaseRequest = {
    condition: "journal",
    phase: "A",
    conditionTrialDir: journalDir,
    workspaceRoot: journalWorkspace.workspaceRoot,
    taskId: spec.taskId,
    prompt: spec.prompt,
    runId: journalRunId,
    parity: spec.journal,
  };
  const journalA = await invoke(journalARequest);
  assertObservedPause(journalA, spec.journal.pausePoint);
  if (
    !journalA.sessionPath ||
    !journalA.storePath ||
    !inside(journalA.sessionPath, journalDir) ||
    !inside(journalA.storePath, journalDir)
  ) {
    throw new EvaluationHarnessError("journal phase A session/store continuity is required");
  }
  const journalB = await invoke({
    ...journalARequest,
    phase: "B",
    sessionPath: journalA.sessionPath,
    storePath: journalA.storePath,
  });
  if (journalA.processId === journalB.processId) {
    throw new EvaluationHarnessError("journal phase B must use a fresh process");
  }
  const processIds = results.map((result) => result.processId);
  if (new Set(processIds).size !== processIds.length) {
    throw new EvaluationHarnessError("all four phase invocations must use distinct processes");
  }
  writeFileSync(resolve(baselineDir, "raw-phase-a.jsonl"), baselineA.rawJsonl, { mode: 0o600 });
  writeFileSync(resolve(baselineDir, "raw-phase-b.jsonl"), baselineB.rawJsonl, { mode: 0o600 });
  writeFileSync(resolve(journalDir, "raw-phase-a.jsonl"), journalA.rawJsonl, { mode: 0o600 });
  writeFileSync(resolve(journalDir, "raw-phase-b.jsonl"), journalB.rawJsonl, { mode: 0o600 });
  const baselineTrace = normalizeEvaluationJsonl(mergePhaseJsonl(baselineA.rawJsonl, baselineB.rawJsonl), {
    workspaceRoot: baselineWorkspace.workspaceRoot,
  });
  const journalTrace = normalizeEvaluationJsonl(mergePhaseJsonl(journalA.rawJsonl, journalB.rawJsonl), {
    workspaceRoot: journalWorkspace.workspaceRoot,
  });
  if (baselineTrace.runId !== baselineRunId || journalTrace.runId !== journalRunId) {
    throw new EvaluationHarnessError("normalized trace run IDs do not match phase receipts");
  }
  const observedBaselineActions = baselineTrace.interventions
    .map((item) => item.kind)
    .filter((kind) => V2_BASELINE_ACTIONS.includes(kind as never));
  if (JSON.stringify(observedBaselineActions) !== JSON.stringify(baselineA.generatedStatus.actions)) {
    throw new EvaluationHarnessError("baseline status actions do not match normalized trace evidence");
  }
  if (journalTrace.materialCases.length > 0 !== (journalB.materialSafety !== undefined)) {
    throw new EvaluationHarnessError("material trace and runtime safety receipt must both be present");
  }
  if (journalB.materialSafety) {
    const cases = journalTrace.materialCases;
    const safetyKinds = journalTrace.interventions
      .map((item) => item.kind)
      .filter((kind) => kind.endsWith("_resolution"));
    if (
      cases.length !== 1 ||
      cases[0].id !== journalB.materialSafety.caseId ||
      cases[0].detectedBeforeContinuation !== (journalB.materialSafety.detectionSequence !== null) ||
      cases[0].resolvedAppendOnly !== journalB.materialSafety.resolutionAppended ||
      cases[0].falsePositive !== journalB.materialSafety.falsePositive ||
      safetyKinds.length !== 1 ||
      safetyKinds[0] !== journalB.materialSafety.safetyInterventionKind
    ) {
      throw new EvaluationHarnessError("material trace does not match the runtime safety receipt");
    }
  }
  const workspaceReceiptDigest = createHash("sha256")
    .update(JSON.stringify({ baselineWorkspace, journalWorkspace, processIds, parity: spec.baseline }))
    .digest("hex");
  for (const trace of [baselineTrace, journalTrace]) {
    trace.provenance.harnessReceipt = {
      schemaVersion: 2,
      runId: trace.runId,
      taskId: trace.taskId,
      parityDigest: computeV2ParityDigest(spec.baseline),
      workspaceReceiptDigest,
      normalizerDigest: trace.provenance.normalizerDigest,
      derivedDigest: trace.provenance.derivedDigest,
      materialCaseIds: trace.materialCases.map((item) => item.id),
    };
    trace.provenance.harnessReceiptDigest = computeV2HarnessReceiptDigest(trace.provenance.harnessReceipt);
  }
  return {
    baselineTrace,
    journalTrace,
    receipt: {
      schemaVersion: 2,
      taskId: spec.taskId,
      runIds: [baselineRunId, journalRunId],
      processIds,
      completedPhases: requests.map((request) => `${request.condition}-${request.phase}`),
      parityDigest: computeV2ParityDigest(spec.baseline),
      baselineStatusGeneratedByPhaseA: true,
      journalContinuityFromPhaseA: true,
      autonomousCheckpoint: true,
      boundedUntrustedResume: true,
      materialSafetyVerified: journalB.materialSafety !== undefined,
      workspaceReceiptDigest,
      privateRawTraceRelativePaths: [
        "baseline/raw-phase-a.jsonl",
        "baseline/raw-phase-b.jsonl",
        "journal/raw-phase-a.jsonl",
        "journal/raw-phase-b.jsonl",
      ],
    },
  };
}

export function createGitWorktreePreparer(
  repositoryRoot: string,
): (condition: EvaluationCondition, targetDir: string, expected: V2ParityReceipt) => Promise<WorkspaceReceipt> {
  return async (_condition, targetDir, expected) => {
    await execFileAsync("git", ["worktree", "add", "--detach", targetDir, expected.repositorySnapshot], {
      cwd: repositoryRoot,
    });
    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: targetDir });
    let detached = false;
    try {
      await execFileAsync("git", ["symbolic-ref", "-q", "HEAD"], { cwd: targetDir });
    } catch {
      detached = true;
    }
    return {
      workspaceRoot: targetDir,
      repositorySnapshot: stdout.trim(),
      promptDigest: expected.promptDigest,
      detached,
    };
  };
}

export function createGitWorktreeCleanup(repositoryRoot: string): (path: string) => void {
  return (path) => {
    execFileSync("git", ["worktree", "remove", "--force", path], { cwd: repositoryRoot, stdio: "ignore" });
  };
}

export function createNodePhaseRunner(executable: string): (request: PhaseRequest) => Promise<PhaseResult> {
  return async (request) =>
    new Promise<PhaseResult>((resolvePromise, reject) => {
      const child = spawn(process.execPath, [executable], {
        cwd: request.workspaceRoot,
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code !== 0) return reject(new EvaluationHarnessError(`phase process failed: ${stderr.trim() || code}`));
        try {
          resolvePromise(JSON.parse(stdout) as PhaseResult);
        } catch {
          reject(new EvaluationHarnessError("phase process returned malformed receipt"));
        }
      });
      child.stdin.end(JSON.stringify(request));
    });
}
