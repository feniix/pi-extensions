import { relative } from "node:path";
import { addConductorArtifact } from "./storage.js";
import type { RunRecord, RunRuntimeMetadata, RunRuntimeMode } from "./types.js";

function isTerminalRunStatus(status: string): boolean {
  return ["succeeded", "partial", "blocked", "failed", "aborted", "stale", "interrupted", "unknown_dispatch"].includes(
    status,
  );
}

function isNonTerminalRuntimeStatus(status: string | undefined): boolean {
  return status === "starting" || status === "running" || status === "unavailable" || status === "unknown";
}

export function recordRuntimeMetadataForRun(input: {
  run: RunRecord;
  runId: string;
  taskId: string;
  workerId: string;
  runtimeMode: RunRuntimeMode;
  metadata: Partial<RunRuntimeMetadata>;
  now?: string;
}): RunRecord {
  const now = input.now ?? new Date().toISOString();
  const logRef = input.metadata.logPath ? runtimeLogArtifactRef(input.run.storageDir, input.metadata.logPath) : null;
  const logRoot = logRef && !/^[a-z][a-z0-9+.-]*:/i.test(logRef) ? "storage" : null;
  const existingLogArtifact = logRef
    ? input.run.artifacts.find((artifact) => artifact.ref === logRef && artifact.resourceRefs.runId === input.runId)
    : null;
  const updatedRuns = input.run.runs.map((entry) => {
    if (entry.runId !== input.runId) return entry;
    const staleNonTerminalUpdate =
      isTerminalRunStatus(entry.status) && isNonTerminalRuntimeStatus(input.metadata.status);
    const metadata = staleNonTerminalUpdate
      ? {
          ...input.metadata,
          status: entry.runtime.status,
          cleanupStatus:
            input.metadata.cleanupStatus === "pending" ? entry.runtime.cleanupStatus : input.metadata.cleanupStatus,
        }
      : input.metadata;
    return {
      ...entry,
      runtime: { ...entry.runtime, ...metadata },
      artifactIds: existingLogArtifact
        ? entry.artifactIds.includes(existingLogArtifact.artifactId)
          ? entry.artifactIds
          : [...entry.artifactIds, existingLogArtifact.artifactId]
        : entry.artifactIds,
      updatedAt: now,
    };
  });
  const updated = { ...input.run, runs: updatedRuns, updatedAt: now };
  if (!logRef || existingLogArtifact) {
    return updated;
  }
  const withArtifact = addConductorArtifact(updated, {
    type: "log",
    ref: logRef,
    resourceRefs: { taskId: input.taskId, runId: input.runId, workerId: input.workerId },
    producer: { type: "system", id: "runtime" },
    metadata: { runtimeMode: input.runtimeMode, path: input.metadata.logPath, ...(logRoot ? { root: logRoot } : {}) },
  });
  const artifact = withArtifact.artifacts.at(-1);
  return artifact
    ? {
        ...withArtifact,
        runs: withArtifact.runs.map((entry) =>
          entry.runId === input.runId
            ? { ...entry, artifactIds: [...entry.artifactIds, artifact.artifactId], updatedAt: now }
            : entry,
        ),
      }
    : withArtifact;
}

function runtimeLogArtifactRef(storageDir: string, logPath: string): string {
  const relativeLog = relative(storageDir, logPath);
  return relativeLog && !relativeLog.startsWith("..") && !relativeLog.startsWith("/")
    ? relativeLog.replace(/\\/g, "/")
    : `file://${logPath}`;
}
