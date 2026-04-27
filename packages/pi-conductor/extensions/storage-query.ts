import { normalizeProjectRecord } from "./storage-normalize.js";
import type { ArtifactRecord, ArtifactType, ConductorEvent, RunRecord } from "./types.js";

export function queryConductorArtifacts(
  run: RunRecord,
  input: {
    workerId?: string;
    taskId?: string;
    runId?: string;
    gateId?: string;
    artifactId?: string;
    type?: ArtifactType;
    afterIndex?: number;
    limit?: number;
  } = {},
): { artifacts: ArtifactRecord[]; lastIndex: number | null; hasMore: boolean } {
  const normalized = normalizeProjectRecord(run);
  const limit = Math.max(1, Math.min(input.limit ?? 20, 100));
  const filtered = normalized.artifacts
    .map((artifact, index) => ({ artifact, index: index + 1 }))
    .filter(({ artifact, index }) => {
      if (input.afterIndex !== undefined && index <= input.afterIndex) {
        return false;
      }
      if (input.type && artifact.type !== input.type) {
        return false;
      }
      for (const key of ["workerId", "taskId", "runId", "gateId", "artifactId"] as const) {
        if (input[key] && artifact.resourceRefs[key] !== input[key] && artifact.artifactId !== input[key]) {
          return false;
        }
      }
      return true;
    });
  const page = filtered.slice(0, limit);
  return {
    artifacts: page.map((entry) => entry.artifact),
    lastIndex: page.at(-1)?.index ?? null,
    hasMore: filtered.length > page.length,
  };
}

export function queryConductorEvents(
  run: RunRecord,
  input: {
    workerId?: string;
    taskId?: string;
    runId?: string;
    gateId?: string;
    artifactId?: string;
    type?: string;
    afterSequence?: number;
    limit?: number;
  } = {},
): { events: ConductorEvent[]; lastSequence: number | null; hasMore: boolean } {
  const normalized = normalizeProjectRecord(run);
  const limit = Math.max(1, Math.min(input.limit ?? 20, 100));
  const filtered = normalized.events.filter((event) => {
    if (input.afterSequence !== undefined && event.sequence <= input.afterSequence) {
      return false;
    }
    if (input.type && event.type !== input.type) {
      return false;
    }
    for (const key of ["workerId", "taskId", "runId", "gateId", "artifactId"] as const) {
      if (input[key] && event.resourceRefs[key] !== input[key]) {
        return false;
      }
    }
    return true;
  });
  const events = filtered.slice(0, limit);
  return {
    events,
    lastSequence: events.at(-1)?.sequence ?? null,
    hasMore: filtered.length > events.length,
  };
}
