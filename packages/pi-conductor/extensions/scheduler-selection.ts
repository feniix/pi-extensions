import type { ConductorNextAction } from "./types.js";

export type SchedulerPolicyName = "safe" | "execute";
export type SchedulerFairness = "priority" | "round_robin";

export interface SchedulerSelectionInput {
  actions: ConductorNextAction[];
  taskObjectiveIds: Map<string, string | null>;
  maxActions: number;
  maxRuns: number;
  perObjectiveLimit: number;
  fairness: SchedulerFairness;
  executeRuns: boolean;
}

export interface SchedulerSelectionResult {
  selected: ConductorNextAction[];
  skipped: Array<{ action: ConductorNextAction; reason: string }>;
}

function objectiveKeyForAction(action: ConductorNextAction, taskObjectiveIds: Map<string, string | null>): string {
  return (
    action.resourceRefs.objectiveId ??
    (action.resourceRefs.taskId ? taskObjectiveIds.get(action.resourceRefs.taskId) : null) ??
    "project"
  );
}

function roundRobinActions(
  actions: ConductorNextAction[],
  taskObjectiveIds: Map<string, string | null>,
): ConductorNextAction[] {
  const buckets = new Map<string, ConductorNextAction[]>();
  for (const action of actions) {
    const key = objectiveKeyForAction(action, taskObjectiveIds);
    buckets.set(key, [...(buckets.get(key) ?? []), action]);
  }
  const ordered: ConductorNextAction[] = [];
  while ([...buckets.values()].some((bucket) => bucket.length > 0)) {
    for (const bucket of buckets.values()) {
      const action = bucket.shift();
      if (action) ordered.push(action);
    }
  }
  return ordered;
}

export function selectSchedulerActions(input: SchedulerSelectionInput): SchedulerSelectionResult {
  const ordered =
    input.fairness === "round_robin" ? roundRobinActions(input.actions, input.taskObjectiveIds) : input.actions;
  const objectiveCounts = new Map<string, number>();
  let runSelections = 0;
  const selected: ConductorNextAction[] = [];
  const skipped: Array<{ action: ConductorNextAction; reason: string }> = [];

  for (const action of ordered) {
    const objectiveKey = objectiveKeyForAction(action, input.taskObjectiveIds);
    if ((objectiveCounts.get(objectiveKey) ?? 0) >= input.perObjectiveLimit) {
      skipped.push({ action, reason: "per-objective scheduler limit reached" });
      continue;
    }
    if (action.kind === "run_task") {
      if (!input.executeRuns) {
        skipped.push({ action, reason: "run execution disabled by scheduler policy" });
        continue;
      }
      if (runSelections >= input.maxRuns) {
        skipped.push({ action, reason: "run capacity exhausted" });
        continue;
      }
      runSelections += 1;
    }
    selected.push(action);
    objectiveCounts.set(objectiveKey, (objectiveCounts.get(objectiveKey) ?? 0) + 1);
    if (selected.length >= input.maxActions) break;
  }

  return { selected, skipped };
}
