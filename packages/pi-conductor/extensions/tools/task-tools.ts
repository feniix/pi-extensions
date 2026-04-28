import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import * as conductor from "../conductor.js";

const runtimeModeSchema = Type.Union([Type.Literal("headless"), Type.Literal("tmux"), Type.Literal("iterm-tmux")]);

export function registerTaskTools(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "conductor_assess_task",
    label: "Conductor Assess Task",
    description: "Assess one task's review readiness, evidence, dependencies, and blockers",
    parameters: Type.Object({
      taskId: Type.String({ description: "Task ID" }),
      requireTestEvidence: Type.Optional(Type.Boolean({ description: "Require linked test_result artifacts" })),
      requirePrEvidence: Type.Optional(Type.Boolean({ description: "Require linked pr_evidence artifacts" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const assessment = conductor.assessTaskForRepo(ctx.cwd, params);
      return {
        content: [{ type: "text", text: `task ${assessment.taskId}: ${assessment.verdict}` }],
        details: { assessment },
      };
    },
  });

  pi.registerTool({
    name: "conductor_task_brief",
    label: "Conductor Task Brief",
    description: "Return a model-ready markdown and structured brief for one durable task",
    parameters: Type.Object({
      taskId: Type.String({ description: "Task ID" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const brief = conductor.buildTaskBriefForRepo(ctx.cwd, params);
      return { content: [{ type: "text", text: brief.markdown }], details: { brief } };
    },
  });

  pi.registerTool({
    name: "conductor_list_tasks",
    label: "Conductor List Tasks",
    description: "List durable pi-conductor tasks for the current repository",
    parameters: Type.Object({
      state: Type.Optional(Type.String({ description: "Optional task state filter" })),
      workerId: Type.Optional(Type.String({ description: "Optional assigned worker ID filter" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const run = conductor.getOrCreateRunForRepo(ctx.cwd);
      const tasks = run.tasks.filter(
        (task) =>
          (!params.state || task.state === params.state) &&
          (!params.workerId || task.assignedWorkerId === params.workerId),
      );
      const text =
        tasks.length === 0
          ? "no conductor tasks"
          : tasks.map((task) => `${task.title} [${task.taskId}] state=${task.state}`).join("\n");
      return { content: [{ type: "text", text }], details: { tasks } };
    },
  });

  pi.registerTool({
    name: "conductor_get_task",
    label: "Conductor Get Task",
    description: "Get one durable task with run, gate, and artifact references",
    parameters: Type.Object({
      taskId: Type.String({ description: "Task ID" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const run = conductor.getOrCreateRunForRepo(ctx.cwd);
      const task = run.tasks.find((entry) => entry.taskId === params.taskId);
      if (!task) {
        return { content: [{ type: "text", text: `task not found: ${params.taskId}` }], details: {} };
      }
      return {
        content: [{ type: "text", text: `${task.title} [${task.taskId}] state=${task.state}` }],
        details: { task },
      };
    },
  });

  pi.registerTool({
    name: "conductor_create_task",
    label: "Conductor Create Task",
    description: "Create a durable pi-conductor task for the current repository",
    parameters: Type.Object({
      title: Type.String({ description: "Task title" }),
      prompt: Type.String({ description: "Task prompt/body" }),
      objectiveId: Type.Optional(Type.String({ description: "Optional objective ID to link this task into" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const task = conductor.createTaskForRepo(ctx.cwd, params);
      return { content: [{ type: "text", text: `created task ${task.title} [${task.taskId}]` }], details: { task } };
    },
  });

  pi.registerTool({
    name: "conductor_update_task",
    label: "Conductor Update Task",
    description: "Update a durable task title or prompt when no run is active; increments task revision",
    parameters: Type.Object({
      taskId: Type.String({ description: "Task ID" }),
      title: Type.Optional(Type.String({ description: "Updated task title" })),
      prompt: Type.Optional(Type.String({ description: "Updated task prompt/body" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const task = conductor.updateTaskForRepo(ctx.cwd, params);
      return {
        content: [{ type: "text", text: `updated task ${task.taskId}: revision=${task.revision}` }],
        details: { task },
      };
    },
  });

  pi.registerTool({
    name: "conductor_assign_task",
    label: "Conductor Assign Task",
    description: "Assign a durable pi-conductor task to a worker",
    parameters: Type.Object({
      taskId: Type.String({ description: "Task ID" }),
      workerId: Type.String({ description: "Worker ID" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const task = conductor.assignTaskForRepo(ctx.cwd, params.taskId, params.workerId);
      return {
        content: [{ type: "text", text: `assigned task ${task.taskId} to ${task.assignedWorkerId}` }],
        details: { task },
      };
    },
  });

  pi.registerTool({
    name: "conductor_delegate_task",
    label: "Conductor Delegate Task",
    description: "Create, assign, and optionally start a task in one parent-agent delegation step",
    parameters: Type.Object({
      title: Type.String({ description: "Task title" }),
      prompt: Type.String({ description: "Task prompt/body" }),
      workerName: Type.String({ description: "Worker name to use or create" }),
      startRun: Type.Optional(Type.Boolean({ description: "Start a durable run immediately; defaults to true" })),
      leaseSeconds: Type.Optional(Type.Number({ description: "Run lease duration in seconds; defaults to 900" })),
      runtimeMode: Type.Optional(runtimeModeSchema),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const delegated = await conductor.delegateTaskForRepo(ctx.cwd, {
        title: params.title,
        prompt: params.prompt,
        workerName: params.workerName,
        startRun: params.startRun ?? true,
        leaseSeconds: params.leaseSeconds,
        runtimeMode: params.runtimeMode,
      });
      const runText = delegated.run ? ` and started run ${delegated.run.runId}` : "";
      return {
        content: [
          {
            type: "text",
            text: `delegated task ${delegated.task.taskId} to worker ${delegated.worker.name} [${delegated.worker.workerId}]${runText}`,
          },
        ],
        details: delegated,
      };
    },
  });

  pi.registerTool({
    name: "conductor_start_task_run",
    label: "Conductor Start Task Run",
    description: "Start a durable task run and return the scoped child task contract",
    parameters: Type.Object({
      taskId: Type.String({ description: "Task ID to start" }),
      workerId: Type.Optional(Type.String({ description: "Worker ID; defaults to the task's assigned worker" })),
      leaseSeconds: Type.Optional(Type.Number({ description: "Lease duration in seconds; defaults to 900" })),
      backend: Type.Optional(Type.Union([Type.Literal("native"), Type.Literal("pi-subagents")])),
      runtimeMode: Type.Optional(runtimeModeSchema),
      allowFollowUpTasks: Type.Optional(
        Type.Boolean({ description: "Allow the child run to create scoped follow-up tasks" }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const started = conductor.startTaskRunForRepo(ctx.cwd, params);
      return {
        content: [
          {
            type: "text",
            text: `started run ${started.run.runId} for task ${started.run.taskId}; pass this task contract to the child worker`,
          },
        ],
        details: started,
      };
    },
  });

  pi.registerTool({
    name: "conductor_run_task",
    label: "Conductor Run Task",
    description: "Run an assigned durable task through its worker using scoped child completion tools",
    parameters: Type.Object({
      taskId: Type.String({ description: "Task ID to run" }),
      runtimeMode: Type.Optional(runtimeModeSchema),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const result = await conductor.runTaskForRepo(ctx.cwd, params.taskId, _signal, {
        runtimeMode: params.runtimeMode,
      });
      const summary = result.finalText ?? result.errorMessage ?? "Run completed without a final assistant summary";
      return {
        content: [{ type: "text", text: `ran task ${params.taskId}: outcome=${result.status} result=${summary}` }],
        details: result,
      };
    },
  });

  pi.registerTool({
    name: "conductor_cancel_task_run",
    label: "Conductor Cancel Task Run",
    description: "Cancel an active durable task run without marking the task complete",
    parameters: Type.Object({
      runId: Type.String({ description: "Run ID to cancel" }),
      reason: Type.String({ description: "Cancellation reason" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const project = await conductor.cancelTaskRunForRepoWithRuntimeCleanup(ctx.cwd, params);
      const run = project.runs.find((entry) => entry.runId === params.runId);
      return {
        content: [{ type: "text", text: `canceled run ${params.runId}: ${params.reason}` }],
        details: { run, projectRevision: project.revision },
      };
    },
  });

  pi.registerTool({
    name: "conductor_retry_task",
    label: "Conductor Retry Task",
    description: "Start a new run for a failed, blocked, canceled, or needs-review task",
    parameters: Type.Object({
      taskId: Type.String({ description: "Task ID to retry" }),
      workerId: Type.Optional(Type.String({ description: "Worker ID; defaults to assigned worker" })),
      leaseSeconds: Type.Optional(Type.Number({ description: "Lease duration in seconds; defaults to 900" })),
      runtimeMode: Type.Optional(runtimeModeSchema),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const retried = conductor.retryTaskForRepo(ctx.cwd, params);
      return {
        content: [{ type: "text", text: `retried task ${params.taskId} as run ${retried.run.runId}` }],
        details: retried,
      };
    },
  });
}
