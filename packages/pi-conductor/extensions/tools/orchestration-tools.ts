import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import * as conductor from "../conductor.js";

const runtimeModeSchema = Type.Union([Type.Literal("headless"), Type.Literal("tmux"), Type.Literal("iterm-tmux")]);

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
      "Run natural-language pi-conductor work and let conductor decide whether to use one worker, parallel workers, or an objective DAG based on dependencies, write scopes, and user intent",
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
      runtimeMode: Type.Optional(runtimeModeSchema),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const result = await conductor.runWorkForRepo(ctx.cwd, params, signal);
      const text =
        result.decision.mode === "parallel"
          ? `routed work to ${result.tasks.length} parallel conductor worker(s): ${result.decision.reason}`
          : result.decision.mode === "objective"
            ? `routed work to an objective with ${result.tasks.length} task(s): ${result.decision.reason}`
            : `routed work to one conductor worker: ${result.decision.reason}`;
      return { content: [{ type: "text", text }], details: result };
    },
  });

  pi.registerTool({
    name: "conductor_run_parallel_work",
    label: "Conductor Run Parallel Work",
    description:
      "Autonomously split a natural-language request into parallel conductor worker tasks, run them under one foreground orchestration boundary, and cancel owned runs/tasks if the user interrupts with Escape",
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
      runtimeMode: Type.Optional(runtimeModeSchema),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const result = await conductor.runParallelWorkForRepo(ctx.cwd, params, signal);
      const completed = result.results.filter((entry) => entry.result?.status === "success").length;
      const text = signal?.aborted
        ? `interrupted parallel conductor work; canceled ${result.canceledRuns.length} active run(s) and ${result.canceledTasks.length} task(s)`
        : `ran ${result.tasks.length} parallel conductor task(s); ${completed} succeeded, ${result.results.length - completed} need follow-up`;
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
      const result = conductor.cancelActiveWorkForRepo(ctx.cwd, params);
      const text =
        result.canceledRuns.length === 0 && result.canceledTasks.length === 0
          ? "no active conductor runs to cancel"
          : `canceled ${result.canceledRuns.length} active conductor run(s) and ${result.canceledTasks.length} task(s)`;
      return { content: [{ type: "text", text }], details: result };
    },
  });
}
