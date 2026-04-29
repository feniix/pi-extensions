import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { formatActiveWorkerViewerSummary, summarizeActiveWorkerViewersForRepo } from "../active-worker-viewer.js";
import * as conductor from "../conductor.js";
import { formatParallelTaskResultsTable } from "../parallel-work-results.js";

function runtimeModeSchema(description?: string) {
  return Type.Union([Type.Literal("headless"), Type.Literal("tmux"), Type.Literal("iterm-tmux")], {
    ...(description ? { description } : {}),
  });
}

export function summarizeParallelWorkToolText(
  result: Awaited<ReturnType<typeof conductor.runParallelWorkForRepo>>,
  aborted = false,
): string {
  const semanticCompleted = result.taskResults.filter((entry) => entry.taskState === "completed").length;
  const launched = result.results.filter((entry) => entry.result?.status === "success").length;
  const runtimeText = `runtime=${result.runtimeMode}${result.runtimeRuns.length > 0 ? ` runs=${result.runtimeRuns.length}` : ""}`;
  const canceledText =
    result.canceledTasks.length > 0 ? `; canceled ${result.canceledTasks.length} pre-run task(s)` : "";
  const finishedText = `${semanticCompleted} completed, ${result.results.length - semanticCompleted} need follow-up${canceledText}`;
  const launchedText = `${launched} launched, ${result.results.length - launched} failed to launch${canceledText}`;
  const followUpText =
    "inspect active viewers with conductor_view_active_workers({}); scope by taskId/workerId/runId; cancel with conductor_cancel_active_work";
  const resultTable = formatParallelTaskResultsTable(result.taskResults);
  if (aborted) {
    return `interrupted parallel conductor work with ${runtimeText}; canceled ${result.canceledRuns.length} active run(s) and ${result.canceledTasks.length} task(s)${resultTable}`;
  }
  return result.runtimeMode === "headless"
    ? `ran ${result.tasks.length} parallel conductor task(s) with ${runtimeText}; ${finishedText}${resultTable}`
    : `launched ${result.tasks.length} parallel conductor task(s) with ${runtimeText}; ${launchedText}; ${followUpText}${resultTable}`;
}

export function summarizeRunWorkToolText(result: Awaited<ReturnType<typeof conductor.runWorkForRepo>>): string {
  const runtimeText = `runtime=${result.runtimeMode}${result.runtimeRuns.length > 0 ? ` runs=${result.runtimeRuns.length}` : ""}`;
  const viewerText =
    result.runtimeRuns.length > 0 ? "; inspect active viewers with conductor_view_active_workers({})" : "";
  const routeText =
    result.decision.mode === "parallel"
      ? `routed work to ${result.tasks.length} parallel conductor worker(s) with ${runtimeText}: ${result.decision.reason}${viewerText}`
      : result.decision.mode === "objective"
        ? `routed work to an objective with ${result.tasks.length} task(s) with ${runtimeText}: ${result.decision.reason}${viewerText}`
        : `routed work to one conductor worker with ${runtimeText}: ${result.decision.reason}${viewerText}`;
  return result.parallel ? `${routeText}\n${summarizeParallelWorkToolText(result.parallel)}` : routeText;
}

export function registerOrchestrationTools(pi: ExtensionAPI): void {
  const workItemSchema = Type.Object({
    title: Type.String({ description: "Short title for this work item" }),
    prompt: Type.String({ description: "Detailed task prompt for this work item" }),
    workerName: Type.Optional(Type.String({ description: "Optional stable worker name for this work item" })),
    writeScope: Type.Optional(
      Type.Array(Type.String({ description: "File, directory, or module this work item expects to touch" })),
    ),
    dependsOn: Type.Optional(Type.Array(Type.String({ description: "Task title this work item depends on" }))),
  });

  pi.registerTool({
    name: "conductor_run_work",
    label: "Conductor Run Work",
    description:
      "Run natural-language pi-conductor work and let conductor decide whether to use one worker, parallel workers, or an objective DAG. Omit runtimeMode to keep single/objective work headless unless visible supervision is requested; parallel work prefers supervised tmux when available and falls back to headless. For parallel tmux/iterm-tmux runs, inspect details.parallel.results[].executionState to distinguish launched supervised work from completed headless work. Use conductor_get_project, conductor_list_workers, conductor_list_runs, or conductor_view_active_workers for status-only requests. Programmatic callers must not treat tool success as semantic completion; inspect executionState/taskResults. Runtime preflight errors can be investigated with conductor_backend_status, and active runtimeRuns include cancelTool details.",
    parameters: Type.Object({
      request: Type.String({ description: "The user's natural-language work request" }),
      mode: Type.Optional(
        Type.Union([Type.Literal("auto"), Type.Literal("single"), Type.Literal("parallel"), Type.Literal("objective")]),
      ),
      tasks: Type.Optional(
        Type.Array(workItemSchema, {
          description:
            "Optional candidate work items inferred from natural language; conductor still decides whether to split them",
        }),
      ),
      workerPrefix: Type.Optional(
        Type.String({ description: "Prefix for generated worker names; defaults to run-work" }),
      ),
      maxWorkers: Type.Optional(Type.Number({ description: "Maximum workers conductor may start in this request" })),
      execute: Type.Optional(Type.Boolean({ description: "Whether to execute after planning; defaults to true" })),
      runtimeMode: Type.Optional(
        runtimeModeSchema(
          "Explicit runtime mode. Pass headless for blocking execution, tmux/iterm-tmux for supervised launch-and-return execution; omit to let parallel work prefer tmux and other work use conservative inference.",
        ),
      ),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const result = await conductor.runWorkForRepo(ctx.cwd, params, signal);
      const text = summarizeRunWorkToolText(result);
      return { content: [{ type: "text", text }], details: result };
    },
  });

  pi.registerTool({
    name: "conductor_run_parallel_work",
    label: "Conductor Run Parallel Work",
    description:
      "Autonomously split a natural-language request into parallel conductor worker tasks. When no runtimeMode is provided, conductor prefers tmux so the tool can launch supervised workers and return control to the parent session for natural-language follow-up; it falls back to headless when tmux is unavailable. Use details.results[].executionState to distinguish completed headless work from launched supervised runs, failed launches, and interruptions. Owned runs/tasks are canceled if the user interrupts with Escape or a task fails before active run creation.",
    parameters: Type.Object({
      tasks: Type.Array(
        Type.Object({
          title: Type.String({ description: "Short title for this parallel work item" }),
          prompt: Type.String({ description: "Detailed task prompt for the worker" }),
          workerName: Type.Optional(Type.String({ description: "Optional stable worker name for this work item" })),
        }),
        { description: "Parallel work items inferred from the user's natural-language request" },
      ),
      workerPrefix: Type.Optional(
        Type.String({ description: "Prefix for generated worker names; defaults to parallel-worker" }),
      ),
      runtimeMode: Type.Optional(
        runtimeModeSchema(
          "Explicit runtime mode for every parallel worker; omit to prefer tmux when available so control returns after launch, or set headless to wait for completion in-process.",
        ),
      ),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const result = await conductor.runParallelWorkForRepo(ctx.cwd, params, signal);
      const text = summarizeParallelWorkToolText(result, signal?.aborted ?? false);
      return { content: [{ type: "text", text }], details: result };
    },
  });

  pi.registerTool({
    name: "conductor_view_active_workers",
    label: "Conductor View Active Workers",
    description:
      "List active supervised tmux/iTerm conductor workers with run IDs, worker names, task titles, runtime/viewer status, attach/log commands, and cancel tool calls. Scope by taskId, workerId, or runId when inspecting one active worker.",
    parameters: Type.Object({
      taskId: Type.Optional(Type.String({ description: "Optional task ID to inspect" })),
      workerId: Type.Optional(Type.String({ description: "Optional worker ID to inspect" })),
      runId: Type.Optional(Type.String({ description: "Optional run ID to inspect" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const summary = summarizeActiveWorkerViewersForRepo(ctx.cwd, {
        taskId: params.taskId as string | undefined,
        workerId: params.workerId as string | undefined,
        runId: params.runId as string | undefined,
      });
      return { content: [{ type: "text", text: formatActiveWorkerViewerSummary(summary) }], details: summary };
    },
  });

  pi.registerTool({
    name: "conductor_cancel_active_work",
    label: "Conductor Cancel Active Work",
    description:
      "Stop active pi-conductor work for natural-language requests like stop, cancel, kill all conductor runs, or escape cleanup; does not require the user to provide run IDs",
    parameters: Type.Object({
      reason: Type.Optional(Type.String({ description: "Why the active work is being canceled" })),
      taskIds: Type.Optional(Type.Array(Type.String({ description: "Optional task IDs to limit cancellation" }))),
      workerIds: Type.Optional(Type.Array(Type.String({ description: "Optional worker IDs to limit cancellation" }))),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const result = await conductor.cancelActiveWorkForRepoWithRuntimeCleanup(ctx.cwd, params);
      const text =
        result.canceledRuns.length === 0 && result.canceledTasks.length === 0
          ? "no active conductor runs to cancel"
          : `canceled ${result.canceledRuns.length} active conductor run(s) and ${result.canceledTasks.length} task(s)`;
      return { content: [{ type: "text", text }], details: result };
    },
  });
}
