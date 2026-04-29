import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import * as conductor from "../conductor.js";

function runtimeModeSchema(description?: string) {
  return Type.Union([Type.Literal("headless"), Type.Literal("tmux"), Type.Literal("iterm-tmux")], {
    ...(description ? { description } : {}),
  });
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
      "Run natural-language pi-conductor work and let conductor decide whether to use one worker, parallel workers, or an objective DAG. Omit runtimeMode for conservative visible-runtime inference; use conductor_get_project, conductor_list_workers, or conductor_list_runs for status-only requests. Runtime preflight errors can be investigated with conductor_backend_status, and active runtimeRuns include cancelTool details.",
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
          "Explicit runtime mode. Omit to allow conservative visible-runtime inference from the request.",
        ),
      ),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const result = await conductor.runWorkForRepo(ctx.cwd, params, signal);
      const runtimeText = `runtime=${result.runtimeMode}${result.runtimeRuns.length > 0 ? ` runs=${result.runtimeRuns.length}` : ""}`;
      const text =
        result.decision.mode === "parallel"
          ? `routed work to ${result.tasks.length} parallel conductor worker(s) with ${runtimeText}: ${result.decision.reason}`
          : result.decision.mode === "objective"
            ? `routed work to an objective with ${result.tasks.length} task(s) with ${runtimeText}: ${result.decision.reason}`
            : `routed work to one conductor worker with ${runtimeText}: ${result.decision.reason}`;
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
      const completed = result.results.filter((entry) => entry.result?.status === "success").length;
      const runtimeText = `runtime=${result.runtimeMode}${result.runtimeRuns.length > 0 ? ` runs=${result.runtimeRuns.length}` : ""}`;
      const canceledText =
        result.canceledTasks.length > 0 ? `; canceled ${result.canceledTasks.length} pre-run task(s)` : "";
      const finishedText = `${completed} succeeded, ${result.results.length - completed} need follow-up${canceledText}`;
      const launchedText = `${completed} launched, ${result.results.length - completed} failed to launch${canceledText}`;
      const followUpText =
        'inspect with conductor_project_brief or conductor_list_runs({ status: "running" }); cancel with conductor_cancel_active_work';
      const resultRows = result.taskResults.map((entry) => {
        const summary = entry.completionSummary
          ? `${entry.completionSummary}${entry.completionSummaryTruncated ? "…" : ""}`
          : "none";
        const next = entry.nextToolCalls.map((call) => `${call.name}(${JSON.stringify(call.params)})`).join("; ");
        return `| ${entry.taskTitle} | ${entry.taskId} | ${entry.workerName ?? "none"} | ${entry.workerId ?? "none"} | ${entry.runId ?? "none"} | ${entry.taskState} | ${entry.runStatus ?? "none"} | ${entry.latestProgress ?? "none"} | ${summary} | ${next} |`;
      });
      const resultTable = [
        "",
        "| Task | taskId | Worker | workerId | runId | Task state | Run status | Latest progress | Completion summary | Next tools |",
        "|---|---|---|---|---|---|---|---|---|---|",
        ...resultRows,
      ].join("\n");
      const text = signal?.aborted
        ? `interrupted parallel conductor work with ${runtimeText}; canceled ${result.canceledRuns.length} active run(s) and ${result.canceledTasks.length} task(s)${resultTable}`
        : result.runtimeMode === "headless"
          ? `ran ${result.tasks.length} parallel conductor task(s) with ${runtimeText}; ${finishedText}${resultTable}`
          : `launched ${result.tasks.length} parallel conductor task(s) with ${runtimeText}; ${launchedText}; ${followUpText}${resultTable}`;
      return { content: [{ type: "text", text }], details: result };
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
