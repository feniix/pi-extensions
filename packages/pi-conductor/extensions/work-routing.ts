export type WorkRoutingMode = "auto" | "single" | "parallel" | "objective";

export type RunWorkItemInput = {
  title: string;
  prompt: string;
  workerName?: string;
  writeScope?: string[];
  dependsOn?: string[];
};

export type WorkRoutingDecision = {
  mode: Exclude<WorkRoutingMode, "auto">;
  confidence: number;
  reason: string;
  tasks: RunWorkItemInput[];
  riskFlags: string[];
};

function hasParallelIntent(request: string): boolean {
  return /\b(parallel|split|many|multiple|workers|fan[- ]?out|deep[- ]?dive|all)\b/i.test(request);
}

function hasSingleIntent(request: string): boolean {
  return /\b(single|one worker|do not split|don't split|dont split|same worker|small|typo)\b/i.test(request);
}

export function deriveWorkTitle(request: string): string {
  const trimmed = request.trim().replace(/\s+/g, " ");
  if (!trimmed) {
    return "Conductor work";
  }
  return trimmed.length > 80 ? `${trimmed.slice(0, 77)}...` : trimmed;
}

function normalizeRunWorkItems(input: { request: string; tasks?: RunWorkItemInput[] }): RunWorkItemInput[] {
  const candidates = input.tasks?.length
    ? input.tasks
    : [{ title: deriveWorkTitle(input.request), prompt: input.request }];
  return candidates.map((task, index) => ({
    ...task,
    title: task.title.trim() || `Work item ${index + 1}`,
    prompt: task.prompt.trim() || input.request.trim(),
    workerName: task.workerName?.trim() || undefined,
    writeScope: task.writeScope?.map((scope) => scope.trim()).filter(Boolean),
    dependsOn: task.dependsOn?.map((dependency) => dependency.trim()).filter(Boolean),
  }));
}

function normalizeWriteScope(scope: string): string {
  return scope.trim().replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
}

function writeScopesOverlap(left: string, right: string): boolean {
  const normalizedLeft = normalizeWriteScope(left);
  const normalizedRight = normalizeWriteScope(right);
  if (!normalizedLeft || !normalizedRight) {
    return false;
  }
  return (
    normalizedLeft === normalizedRight ||
    normalizedLeft.startsWith(`${normalizedRight}/`) ||
    normalizedRight.startsWith(`${normalizedLeft}/`)
  );
}

function findOverlappingWriteScopes(tasks: RunWorkItemInput[]): boolean {
  const seen: string[] = [];
  for (const task of tasks) {
    for (const scope of task.writeScope ?? []) {
      if (seen.some((knownScope) => writeScopesOverlap(knownScope, scope))) {
        return true;
      }
      seen.push(scope);
    }
  }
  return false;
}

function combineWorkItems(tasks: RunWorkItemInput[], request: string): RunWorkItemInput {
  if (tasks.length === 1 && tasks[0]) {
    return tasks[0];
  }
  return {
    title: deriveWorkTitle(request),
    prompt: [
      request.trim(),
      "",
      "Run these work items coherently in one conductor worker because splitting is unsafe:",
      ...tasks.map((task, index) => `${index + 1}. ${task.title}\n${task.prompt}`),
    ].join("\n"),
    writeScope: [...new Set(tasks.flatMap((task) => task.writeScope ?? []))],
    dependsOn: [...new Set(tasks.flatMap((task) => task.dependsOn ?? []))],
  };
}

function capParallelWorkItems(tasks: RunWorkItemInput[], maxWorkers: number): RunWorkItemInput[] {
  if (tasks.length <= maxWorkers) {
    return tasks;
  }
  const buckets = Array.from({ length: maxWorkers }, () => [] as RunWorkItemInput[]);
  for (const [index, task] of tasks.entries()) {
    buckets[index % maxWorkers]?.push(task);
  }
  return buckets.map((bucket, index) => ({
    title: bucket.length === 1 ? (bucket[0]?.title ?? `Work shard ${index + 1}`) : `Work shard ${index + 1}`,
    prompt:
      bucket.length === 1
        ? (bucket[0]?.prompt ?? "")
        : bucket.map((task, taskIndex) => `${taskIndex + 1}. ${task.title}\n${task.prompt}`).join("\n\n"),
    workerName: bucket.length === 1 ? bucket[0]?.workerName : undefined,
    writeScope: [...new Set(bucket.flatMap((task) => task.writeScope ?? []))],
  }));
}

export function planWorkRouting(input: {
  request: string;
  mode?: WorkRoutingMode;
  tasks?: RunWorkItemInput[];
  maxWorkers?: number;
}): WorkRoutingDecision {
  const request = input.request.trim();
  if (!request) {
    throw new Error("conductor_run_work requires a natural-language request");
  }
  const maxWorkers = Math.max(1, Math.floor(input.maxWorkers ?? 4));
  const tasks = normalizeRunWorkItems({ request, tasks: input.tasks });
  const riskFlags: string[] = [];
  const hasDependencies = tasks.some((task) => (task.dependsOn?.length ?? 0) > 0);
  const hasScopeOverlap = findOverlappingWriteScopes(tasks);
  if (hasScopeOverlap) {
    riskFlags.push("overlapping_write_scope");
  }
  if (tasks.length > maxWorkers) {
    riskFlags.push("worker_cap_applied");
  }

  const requestedMode = input.mode ?? "auto";
  if (requestedMode === "single") {
    return {
      mode: "single",
      confidence: 1,
      reason: "Single-worker mode was requested explicitly.",
      tasks: [combineWorkItems(tasks, request)],
      riskFlags,
    };
  }
  if (requestedMode === "objective" || hasDependencies) {
    return {
      mode: "objective",
      confidence: requestedMode === "objective" ? 1 : 0.9,
      reason:
        requestedMode === "objective"
          ? "Objective mode was requested explicitly."
          : "Dependent work requires objective scheduling instead of parallel fan-out.",
      tasks,
      riskFlags,
    };
  }

  if (tasks.length <= 1 || hasSingleIntent(request) || hasScopeOverlap || maxWorkers === 1) {
    return {
      mode: "single",
      confidence: tasks.length <= 1 ? 0.95 : 0.8,
      reason:
        tasks.length <= 1
          ? "Single coherent work item; splitting would add coordination overhead."
          : "Work should stay in one worker because parallel splitting is unsafe or was discouraged.",
      tasks: [combineWorkItems(tasks, request)],
      riskFlags,
    };
  }

  if (requestedMode === "parallel" || hasParallelIntent(request)) {
    return {
      mode: "parallel",
      confidence: requestedMode === "parallel" ? 1 : 0.85,
      reason: "Independent work items can run in parallel under one foreground cancellation boundary.",
      tasks: capParallelWorkItems(tasks, maxWorkers),
      riskFlags,
    };
  }

  return {
    mode: "single",
    confidence: 0.65,
    reason: "No explicit parallel intent; defaulting to one coherent worker.",
    tasks: [combineWorkItems(tasks, request)],
    riskFlags,
  };
}
