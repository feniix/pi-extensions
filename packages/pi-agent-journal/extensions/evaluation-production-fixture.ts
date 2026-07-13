#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { MaterialSafetyReceipt } from "./evaluation-harness.js";
import { V2_OWNER_PROTOCOL_DIGEST, V2_OWNER_STATUS_FIELDS } from "./evaluation-v2.js";
import { JournalService } from "./journal-service.js";
import { createPiJournalRuntime } from "./pi-runtime.js";
import { JournalStorage } from "./storage.js";

interface Request {
  condition: "baseline" | "journal";
  phase: "A" | "B";
  conditionTrialDir: string;
  workspaceRoot: string;
  taskId: string;
  runId: string;
  parity: { pausePoint: string };
  generatedStatusPath?: string;
  sessionPath?: string;
  storePath?: string;
}

type Handler = (event: unknown, context: ExtensionContext) => Promise<unknown> | unknown;

function runtimeHost(branch: unknown[]) {
  const handlers = new Map<string, Handler[]>();
  const api = {
    on: (event: string, handler: Handler) => handlers.set(event, [...(handlers.get(event) ?? []), handler]),
    appendEntry: (customType: string, data: unknown) => branch.push({ type: "custom", customType, data }),
  } as unknown as ExtensionAPI;
  const context = {
    cwd: process.cwd(),
    mode: "json",
    hasUI: false,
    sessionManager: {
      getBranch: () => branch,
      getLeafId: () => "evaluation-leaf",
    },
    isIdle: () => true,
  } as unknown as ExtensionContext;
  return { api, handlers, context };
}

async function emit(host: ReturnType<typeof runtimeHost>, event: string, payload: unknown) {
  let result: unknown;
  for (const handler of host.handlers.get(event) ?? []) result = await handler(payload, host.context);
  return result;
}

const request = JSON.parse(readFileSync(0, "utf8")) as Request;
const tracePath = join(request.conditionTrialDir, `production-${request.phase}.jsonl`);
const result: Record<string, unknown> = {
  processId: String(process.pid),
  completed: true,
  rawJsonl: "",
  ephemeralTracePaths: [tracePath],
};

if (request.condition === "baseline" && request.phase === "A") {
  const path = join(request.conditionTrialDir, "generated-status.txt");
  const status = [
    "Objective: generated during production phase A",
    "Current status: paused",
    "Settled decisions: none",
    "Evidence: none",
    "Open questions: none",
    "Next action: resume",
    "Material dependencies: none",
    "",
  ].join("\n");
  writeFileSync(path, status, { mode: 0o600 });
  result.generatedStatus = {
    path,
    generatedByPhaseA: true,
    byteLength: Buffer.byteLength(status, "utf8"),
    fields: [...V2_OWNER_STATUS_FIELDS],
    actions: ["status_create"],
    ownerProtocolDigest: V2_OWNER_PROTOCOL_DIGEST,
  };
}
if (request.condition === "baseline" && request.phase === "B")
  readFileSync(request.generatedStatusPath as string, "utf8");

if (request.condition === "journal" && request.phase === "A") {
  const sessionPath = join(request.conditionTrialDir, "production-session.json");
  const storePath = join(request.conditionTrialDir, "production-store");
  const branch: unknown[] = [];
  const host = runtimeHost(branch);
  const storage = new JournalStorage(storePath);
  const service = new JournalService({ storage, workspaceRoot: request.workspaceRoot });
  const runtime = createPiJournalRuntime(host.api, {
    storage,
    service,
    sessionIdGenerator: () => `eval-${request.runId}`,
  });
  await emit(host, "session_start", { type: "session_start", reason: "new" });
  const sessionId = runtime.getActiveSessionId() as string;
  const materialPath = join(request.workspaceRoot, "evaluation-material.txt");
  writeFileSync(materialPath, "before\n", { mode: 0o600 });
  const dependency = await service.observeFileDependency("evaluation-material.txt", "material-entry", true);
  await service.record(sessionId, {
    id: "material-entry",
    type: "evidence",
    content: "material fixture evidence",
    dependencies: [dependency],
  });
  await service.record(sessionId, { type: "next_action", content: "resume production evaluation" });
  await emit(host, "agent_settled", { type: "agent_settled" });
  const session = await storage.getSession(sessionId);
  writeFileSync(sessionPath, JSON.stringify({ branch, sessionId, materialPath }), { mode: 0o600 });
  result.autonomousCheckpoint = session.checkpoints.length > 0;
  result.ownerJournalCalls = 0;
  result.sessionPath = sessionPath;
  result.storePath = storePath;
}

if (request.condition === "journal" && request.phase === "B") {
  const saved = JSON.parse(readFileSync(request.sessionPath as string, "utf8")) as {
    branch: unknown[];
    sessionId: string;
    materialPath: string;
  };
  const host = runtimeHost(saved.branch);
  const storage = new JournalStorage(request.storePath as string);
  const service = new JournalService({ storage, workspaceRoot: request.workspaceRoot });
  createPiJournalRuntime(host.api, { storage, service });
  writeFileSync(saved.materialPath, "after\n", { mode: 0o600 });
  await emit(host, "session_start", { type: "session_start", reason: "resume" });
  const injected = (await emit(host, "before_agent_start", { type: "before_agent_start" })) as
    | { message?: { content?: unknown } }
    | undefined;
  const content = injected?.message?.content;
  const staleResume = await service.resume(saved.sessionId);
  const beforeResolution = await storage.getSession(saved.sessionId);
  const originalNotices = JSON.stringify(beforeResolution.notices);
  const originalEntries = new Map(beforeResolution.entries.map((entry) => [entry.id, JSON.stringify(entry)]));
  const freshDependency = await service.observeFileDependency("evaluation-material.txt", "fresh-entry", true);
  const freshEntry = await service.record(saved.sessionId, {
    id: "fresh-entry",
    type: "evidence",
    content: "revalidated material fixture evidence",
    dependencies: [freshDependency],
  });
  await service.createCheckpoint(saved.sessionId, {
    objective: "production material safety fixture",
    status: "revalidated",
    evidenceEntryIds: [freshEntry.id],
    artifactDependencies: [freshDependency],
    supportEntryIds: [freshEntry.id],
  });
  await service.resume(saved.sessionId);
  const afterResolution = await storage.getSession(saved.sessionId);
  const staleNotice = beforeResolution.notices.find((notice) => notice.affectedIds.includes("material-entry"));
  result.freshProcessResume = typeof content === "string" && content.includes("UNTRUSTED historical work data");
  result.boundedUntrustedResume = result.freshProcessResume;
  result.resumeCapsuleBytes = typeof content === "string" ? Buffer.byteLength(content, "utf8") : 0;
  let observedSequence = 0;
  const detectionSequence = staleNotice ? ++observedSequence : null;
  const unsafeContinuationSequence = ++observedSequence;
  result.materialSafety = {
    caseId: "production-material-case",
    noticePersistedAcrossRestart: Boolean(staleNotice),
    staleSupportWithheld: !staleResume.entries.some((entry) => entry.id === "material-entry"),
    detectionSequence,
    unsafeContinuationSequence,
    resolutionAppended: afterResolution.noticeResolutions.some((item) => item.noticeId === staleNotice?.id),
    noticeHistoryUnchanged: JSON.stringify(afterResolution.notices) === originalNotices,
    entryHistoryUnchanged: [...originalEntries].every(
      ([id, entry]) => JSON.stringify(afterResolution.entries.find((candidate) => candidate.id === id)) === entry,
    ),
    falsePositive: staleNotice === undefined,
    safetyInterventionKind: staleNotice ? "material_stale_resolution" : "material_conflict_resolution",
  };
}

const safety = result.materialSafety as MaterialSafetyReceipt | undefined;
const materialTaskCorrect =
  safety === undefined ||
  (safety.noticePersistedAcrossRestart &&
    safety.staleSupportWithheld &&
    safety.detectionSequence !== null &&
    safety.unsafeContinuationSequence !== null &&
    safety.detectionSequence < safety.unsafeContinuationSequence &&
    safety.resolutionAppended &&
    safety.noticeHistoryUnchanged &&
    safety.entryHistoryUnchanged &&
    !safety.falsePositive);
const events: unknown[] = [
  {
    type: "evaluation_trace",
    schemaVersion: 2,
    sourceEvaluationVersion: 2,
    runId: request.runId,
    taskId: request.taskId,
    taskScore: materialTaskCorrect ? 10 : 0,
    resumedWithoutRestatement: request.phase === "A" || result.freshProcessResume === true,
    materialTaskCorrect,
  },
];
if (request.phase === "A") {
  events.push({ type: "evaluation_pause", pausePoint: request.parity.pausePoint, observed: true });
}
if (request.condition === "baseline" && request.phase === "A") {
  events.push({ type: "evaluation_intervention", id: `owner-${request.runId}`, kind: "status_create", sequence: 1 });
}
if (request.condition === "journal" && request.phase === "B") {
  events.push(
    {
      type: "evaluation_intervention",
      id: `safety-${request.runId}`,
      kind: safety?.safetyInterventionKind,
      sequence: safety?.detectionSequence,
    },
    {
      type: "evaluation_material_case",
      id: safety?.caseId,
      sequence: safety?.unsafeContinuationSequence,
      detectedBeforeContinuation:
        safety?.detectionSequence !== null &&
        safety?.detectionSequence !== undefined &&
        safety.unsafeContinuationSequence !== null &&
        safety.detectionSequence < safety.unsafeContinuationSequence,
      resolvedAppendOnly:
        safety?.resolutionAppended === true && safety.noticeHistoryUnchanged && safety.entryHistoryUnchanged,
      falsePositive: safety?.falsePositive ?? true,
    },
  );
}
result.rawJsonl = events.map((event) => JSON.stringify(event)).join("\n");
writeFileSync(tracePath, result.rawJsonl as string, { mode: 0o600 });
process.stdout.write(JSON.stringify(result));
