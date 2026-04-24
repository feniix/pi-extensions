import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { inspectConductorBackends } from "./backends.js";
import { runConductorCommand } from "./commands.js";
import {
  assignTaskForRepo,
  commitWorkerForRepo,
  createGateForRepo,
  createTaskForRepo,
  createWorkerForRepo,
  createWorkerPrForRepo,
  delegateTaskForRepo,
  getOrCreateRunForRepo,
  pushWorkerForRepo,
  reconcileProjectForRepo,
  reconcileWorkerHealth,
  recordTaskCompletionForRepo,
  recordTaskProgressForRepo,
  recoverWorkerForRepo,
  refreshWorkerSummaryForRepo,
  removeWorkerForRepo,
  resolveGateForRepo,
  resumeWorkerForRepo,
  runTaskForRepo,
  runWorkerForRepo,
  startTaskRunForRepo,
  updateWorkerLifecycleForRepo,
  updateWorkerTaskForRepo,
} from "./conductor.js";
import { deriveProjectKey } from "./project-key.js";
import { formatRunStatus } from "./status.js";
import { createEmptyRun, readRun, writeRun } from "./storage.js";

function findRepoRoot(cwd: string): string | null {
  try {
    return execSync("git rev-parse --show-toplevel", {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return null;
  }
}

function getStatusText(cwd: string): string {
  const repoRoot = findRepoRoot(cwd);
  if (!repoRoot) {
    return "pi-conductor: not inside a git repository";
  }

  const projectKey = deriveProjectKey(repoRoot);
  const run = readRun(projectKey) ?? createEmptyRun(projectKey, repoRoot);
  if (!existsSync(run.storageDir)) {
    writeRun(run);
  }

  return formatRunStatus(reconcileWorkerHealth(getOrCreateRunForRepo(repoRoot)));
}

export default function conductorExtension(pi: ExtensionAPI) {
  pi.registerCommand("conductor-status", {
    description: "Show the current pi-conductor project status",
    handler: async (_args, ctx) => {
      const text = getStatusText(ctx.cwd);
      if (ctx.hasUI) {
        ctx.ui.notify(text, "info");
      } else {
        console.log(text);
      }
    },
  });

  pi.registerCommand("conductor", {
    description: "Manage pi-conductor workers and PR preparation",
    handler: async (args, ctx) => {
      const text = await runConductorCommand(ctx.cwd, args);
      if (ctx.hasUI) {
        ctx.ui.notify(text, "info");
      } else {
        console.log(text);
      }
    },
  });

  pi.registerTool({
    name: "conductor_get_project",
    label: "Conductor Get Project",
    description: "Get current pi-conductor project metadata and concise aggregate status",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const repoRoot = findRepoRoot(ctx.cwd);
      if (!repoRoot) {
        return { content: [{ type: "text", text: "pi-conductor: not inside a git repository" }], details: {} };
      }
      const run = getOrCreateRunForRepo(repoRoot);
      return {
        content: [
          {
            type: "text",
            text: `project ${run.projectKey}: workers=${run.workers.length} tasks=${run.tasks.length} runs=${run.runs.length} events=${run.events.length}`,
          },
        ],
        details: {
          projectKey: run.projectKey,
          repoRoot: run.repoRoot,
          storageDir: run.storageDir,
          schemaVersion: run.schemaVersion,
          revision: run.revision,
          workers: run.workers.length,
          tasks: run.tasks.length,
          runs: run.runs.length,
          gates: run.gates.length,
          artifacts: run.artifacts.length,
          events: run.events.length,
        },
      };
    },
  });

  pi.registerTool({
    name: "conductor_reconcile_project",
    label: "Conductor Reconcile Project",
    description: "Reconcile conductor leases and worker health for the current repository",
    parameters: Type.Object({
      dryRun: Type.Optional(Type.Boolean({ description: "Preview reconciliation without persisting changes" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const before = getOrCreateRunForRepo(ctx.cwd);
      const after = reconcileProjectForRepo(ctx.cwd, { dryRun: params.dryRun ?? false });
      const changed = after.revision !== before.revision || after.updatedAt !== before.updatedAt;
      return {
        content: [
          {
            type: "text",
            text: `${params.dryRun ? "previewed" : "reconciled"} project ${after.projectKey}: changed=${changed} workers=${after.workers.length} tasks=${after.tasks.length} runs=${after.runs.length}`,
          },
        ],
        details: { project: after, changed, dryRun: params.dryRun ?? false },
      };
    },
  });

  pi.registerTool({
    name: "conductor_backend_status",
    label: "Conductor Backend Status",
    description: "Inspect native and optional pi-subagents backend adapter availability",
    parameters: Type.Object({}),
    async execute() {
      const backends = inspectConductorBackends();
      const text = [
        `native: available=${backends.native.available}`,
        `pi-subagents: available=${backends.piSubagents.available}${backends.piSubagents.diagnostic ? ` (${backends.piSubagents.diagnostic})` : ""}`,
      ].join("\n");
      return { content: [{ type: "text", text }], details: backends };
    },
  });

  pi.registerTool({
    name: "conductor_list_events",
    label: "Conductor List Events",
    description: "List recent durable conductor events for the current repository",
    parameters: Type.Object({
      limit: Type.Optional(Type.Number({ description: "Maximum events to return; defaults to 20" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const run = getOrCreateRunForRepo(ctx.cwd);
      const limit = Math.max(1, Math.min(params.limit ?? 20, 100));
      const events = run.events.slice(-limit);
      const text =
        events.length === 0
          ? "no conductor events"
          : events.map((event) => `#${event.sequence} ${event.type} ${event.occurredAt}`).join("\n");
      return { content: [{ type: "text", text }], details: { events } };
    },
  });

  pi.registerTool({
    name: "conductor_list_artifacts",
    label: "Conductor List Artifacts",
    description: "List durable conductor artifacts for the current repository",
    parameters: Type.Object({
      limit: Type.Optional(Type.Number({ description: "Maximum artifacts to return; defaults to 20" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const run = getOrCreateRunForRepo(ctx.cwd);
      const limit = Math.max(1, Math.min(params.limit ?? 20, 100));
      const artifacts = run.artifacts.slice(-limit);
      const text =
        artifacts.length === 0
          ? "no conductor artifacts"
          : artifacts.map((artifact) => `${artifact.artifactId} ${artifact.type} ${artifact.ref}`).join("\n");
      return { content: [{ type: "text", text }], details: { artifacts } };
    },
  });

  pi.registerTool({
    name: "conductor_list_workers",
    label: "Conductor List Workers",
    description: "List durable pi-conductor workers for the current repository",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const run = getOrCreateRunForRepo(ctx.cwd);
      const text =
        run.workers.length === 0
          ? "no conductor workers"
          : run.workers.map((worker) => `${worker.name} [${worker.workerId}] state=${worker.lifecycle}`).join("\n");
      return { content: [{ type: "text", text }], details: { workers: run.workers } };
    },
  });

  pi.registerTool({
    name: "conductor_create_worker",
    label: "Conductor Create Worker",
    description: "Create a durable pi-conductor worker for the current repository",
    parameters: Type.Object({
      name: Type.String({ description: "Worker name" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const worker = await createWorkerForRepo(ctx.cwd, params.name);
      return {
        content: [
          { type: "text", text: `created worker ${worker.name} [${worker.workerId}] on branch ${worker.branch}` },
        ],
        details: { worker },
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
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const task = createTaskForRepo(ctx.cwd, params);
      return { content: [{ type: "text", text: `created task ${task.title} [${task.taskId}]` }], details: { task } };
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
      const task = assignTaskForRepo(ctx.cwd, params.taskId, params.workerId);
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
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const delegated = await delegateTaskForRepo(ctx.cwd, {
        title: params.title,
        prompt: params.prompt,
        workerName: params.workerName,
        startRun: params.startRun ?? true,
        leaseSeconds: params.leaseSeconds,
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

  const artifactTypeSchema = Type.Union([
    Type.Literal("note"),
    Type.Literal("test_result"),
    Type.Literal("changed_files"),
    Type.Literal("log"),
    Type.Literal("completion_report"),
    Type.Literal("pr_evidence"),
    Type.Literal("other"),
  ]);

  const gateTypeSchema = Type.Union([
    Type.Literal("needs_input"),
    Type.Literal("needs_review"),
    Type.Literal("approval_required"),
    Type.Literal("ready_for_pr"),
    Type.Literal("destructive_cleanup"),
  ]);

  pi.registerTool({
    name: "conductor_create_gate",
    label: "Conductor Create Gate",
    description: "Create a gate for parent/human approval, review, or input before risky work proceeds",
    parameters: Type.Object({
      type: gateTypeSchema,
      requestedDecision: Type.String({ description: "Decision or review needed" }),
      resourceRefs: Type.Object(
        {
          workerId: Type.Optional(Type.String()),
          taskId: Type.Optional(Type.String()),
          runId: Type.Optional(Type.String()),
          artifactId: Type.Optional(Type.String()),
        },
        { additionalProperties: false },
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const gate = createGateForRepo(ctx.cwd, params);
      return {
        content: [{ type: "text", text: `created gate ${gate.gateId}: ${gate.requestedDecision}` }],
        details: { gate },
      };
    },
  });

  pi.registerTool({
    name: "conductor_resolve_gate",
    label: "Conductor Resolve Gate",
    description: "Resolve an open conductor gate with an explicit decision",
    parameters: Type.Object({
      gateId: Type.String({ description: "Gate ID" }),
      status: Type.Union([Type.Literal("approved"), Type.Literal("rejected"), Type.Literal("canceled")]),
      resolutionReason: Type.String({ description: "Reason for the gate decision" }),
      actorId: Type.String({ description: "Identifier for the human or parent agent resolving the gate" }),
      actorType: Type.Optional(Type.Union([Type.Literal("human"), Type.Literal("parent_agent")])),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const gate = resolveGateForRepo(ctx.cwd, {
        gateId: params.gateId,
        status: params.status,
        resolutionReason: params.resolutionReason,
        actor: { type: params.actorType ?? "parent_agent", id: params.actorId },
      });
      return {
        content: [{ type: "text", text: `resolved gate ${gate.gateId}: ${gate.status}` }],
        details: { gate },
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
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const started = startTaskRunForRepo(ctx.cwd, params);
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
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const result = await runTaskForRepo(ctx.cwd, params.taskId);
      const summary = result.finalText ?? result.errorMessage ?? "Run completed without a final assistant summary";
      return {
        content: [{ type: "text", text: `ran task ${params.taskId}: outcome=${result.status} result=${summary}` }],
        details: result,
      };
    },
  });

  pi.registerTool({
    name: "conductor_child_progress",
    label: "Conductor Child Progress",
    description: "Scoped child-run tool for reporting task progress and optional evidence artifacts",
    parameters: Type.Object({
      runId: Type.String({ description: "Run ID from the task contract" }),
      taskId: Type.String({ description: "Task ID from the task contract" }),
      progress: Type.String({ description: "Concise progress update" }),
      artifact: Type.Optional(
        Type.Object({
          type: artifactTypeSchema,
          ref: Type.String({ description: "Artifact reference, URL, file path, or durable URI" }),
          metadata: Type.Optional(Type.Object({}, { additionalProperties: true })),
        }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const task = recordTaskProgressForRepo(ctx.cwd, {
        ...params,
        artifact: params.artifact
          ? { ...params.artifact, metadata: params.artifact.metadata as Record<string, unknown> | undefined }
          : undefined,
      });
      return {
        content: [{ type: "text", text: `recorded progress for task ${task.taskId}: ${task.latestProgress}` }],
        details: { task },
      };
    },
  });

  pi.registerTool({
    name: "conductor_child_complete",
    label: "Conductor Child Complete",
    description: "Scoped child-run tool for completing a task run with a summary and optional evidence artifact",
    parameters: Type.Object({
      runId: Type.String({ description: "Run ID from the task contract" }),
      taskId: Type.String({ description: "Task ID from the task contract" }),
      status: Type.Union([
        Type.Literal("succeeded"),
        Type.Literal("partial"),
        Type.Literal("blocked"),
        Type.Literal("failed"),
        Type.Literal("aborted"),
      ]),
      completionSummary: Type.String({ description: "Completion summary for the parent agent" }),
      artifact: Type.Optional(
        Type.Object({
          type: artifactTypeSchema,
          ref: Type.String({ description: "Artifact reference, URL, file path, or durable URI" }),
          metadata: Type.Optional(Type.Object({}, { additionalProperties: true })),
        }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const task = recordTaskCompletionForRepo(ctx.cwd, {
        ...params,
        artifact: params.artifact
          ? { ...params.artifact, metadata: params.artifact.metadata as Record<string, unknown> | undefined }
          : undefined,
      });
      return {
        content: [{ type: "text", text: `completed task ${task.taskId}: state=${task.state}` }],
        details: { task },
      };
    },
  });

  pi.registerTool({
    name: "conductor_cleanup_worker",
    label: "Conductor Cleanup Worker",
    description: "Gate-protected cleanup for a named worker, its worktree, session link, and branch",
    parameters: Type.Object({
      name: Type.String({ description: "Worker name" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const worker = removeWorkerForRepo(ctx.cwd, params.name);
      return {
        content: [{ type: "text", text: `removed worker ${worker.name} [${worker.workerId}]` }],
        details: { workerId: worker.workerId },
      };
    },
  });

  pi.registerTool({
    name: "conductor_commit_worker",
    label: "Conductor Commit Worker",
    description: "Commit all current changes in a worker worktree",
    parameters: Type.Object({
      name: Type.String({ description: "Worker name" }),
      message: Type.String({ description: "Commit message" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const worker = commitWorkerForRepo(ctx.cwd, params.name, params.message);
      return {
        content: [{ type: "text", text: `committed worker ${worker.name}: ${params.message}` }],
        details: { workerId: worker.workerId, commitSucceeded: worker.pr.commitSucceeded },
      };
    },
  });

  pi.registerTool({
    name: "conductor_push_worker",
    label: "Conductor Push Worker",
    description: "Push a worker branch to origin",
    parameters: Type.Object({
      name: Type.String({ description: "Worker name" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const worker = pushWorkerForRepo(ctx.cwd, params.name);
      return {
        content: [{ type: "text", text: `pushed worker ${worker.name} on branch ${worker.branch}` }],
        details: { workerId: worker.workerId, pushSucceeded: worker.pr.pushSucceeded },
      };
    },
  });

  pi.registerTool({
    name: "conductor_create_worker_pr",
    label: "Conductor Create Worker PR",
    description: "Gate-protected GitHub PR creation for a worker branch",
    parameters: Type.Object({
      name: Type.String({ description: "Worker name" }),
      title: Type.String({ description: "PR title" }),
      body: Type.Optional(Type.String({ description: "Optional PR body" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const worker = createWorkerPrForRepo(ctx.cwd, params.name, params.title, params.body);
      return {
        content: [{ type: "text", text: `created PR for ${worker.name}: ${worker.pr.url}` }],
        details: { workerId: worker.workerId, pr: worker.pr },
      };
    },
  });

  pi.registerTool({
    name: "conductor_status",
    label: "Conductor Status",
    description: "Show the current pi-conductor project namespace and worker status",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const text = getStatusText(ctx.cwd);
      return {
        content: [{ type: "text", text }],
        details: {},
      };
    },
  });

  pi.registerTool({
    name: "conductor_start",
    label: "Conductor Start",
    description: "Create a new pi-conductor worker for the current repository",
    parameters: Type.Object({
      name: Type.String({ description: "Worker name" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const worker = await createWorkerForRepo(ctx.cwd, params.name);
      return {
        content: [
          { type: "text", text: `created worker ${worker.name} [${worker.workerId}] on branch ${worker.branch}` },
        ],
        details: { workerId: worker.workerId, branch: worker.branch, worktreePath: worker.worktreePath },
      };
    },
  });

  pi.registerTool({
    name: "conductor_task_update",
    label: "Conductor Task Update",
    description: "Update the current task for a named pi-conductor worker",
    parameters: Type.Object({
      name: Type.String({ description: "Worker name" }),
      task: Type.String({ description: "Task text" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const worker = updateWorkerTaskForRepo(ctx.cwd, params.name, params.task);
      return {
        content: [{ type: "text", text: `updated task for ${worker.name}: ${worker.currentTask}` }],
        details: { workerId: worker.workerId, task: worker.currentTask },
      };
    },
  });

  pi.registerTool({
    name: "conductor_recover",
    label: "Conductor Recover",
    description: "Recover a broken pi-conductor worker with a missing session link",
    parameters: Type.Object({
      name: Type.String({ description: "Worker name" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const worker = await recoverWorkerForRepo(ctx.cwd, params.name);
      return {
        content: [{ type: "text", text: `recovered worker ${worker.name}: session=${worker.sessionFile}` }],
        details: { workerId: worker.workerId, sessionFile: worker.sessionFile },
      };
    },
  });

  pi.registerTool({
    name: "conductor_summary_refresh",
    label: "Conductor Summary Refresh",
    description: "Refresh a named pi-conductor worker summary from its persisted session",
    parameters: Type.Object({
      name: Type.String({ description: "Worker name" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const worker = await refreshWorkerSummaryForRepo(ctx.cwd, params.name);
      return {
        content: [{ type: "text", text: `refreshed summary for ${worker.name}: ${worker.summary.text}` }],
        details: { workerId: worker.workerId, summary: worker.summary },
      };
    },
  });

  pi.registerTool({
    name: "conductor_cleanup",
    label: "Conductor Cleanup",
    description: "Remove a named pi-conductor worker and clean up its worktree and session link",
    parameters: Type.Object({
      name: Type.String({ description: "Worker name" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const worker = removeWorkerForRepo(ctx.cwd, params.name);
      return {
        content: [{ type: "text", text: `removed worker ${worker.name} [${worker.workerId}]` }],
        details: { workerId: worker.workerId },
      };
    },
  });

  pi.registerTool({
    name: "conductor_resume",
    label: "Conductor Resume",
    description: "Resume a healthy pi-conductor worker using its persisted worktree and session linkage",
    parameters: Type.Object({
      name: Type.String({ description: "Worker name" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const worker = await resumeWorkerForRepo(ctx.cwd, params.name);
      return {
        content: [{ type: "text", text: `resumed worker ${worker.name}: session=${worker.sessionFile}` }],
        details: { workerId: worker.workerId, sessionFile: worker.sessionFile, worktreePath: worker.worktreePath },
      };
    },
  });

  pi.registerTool({
    name: "conductor_run",
    label: "Conductor Run",
    description: "Run one foreground task in a named pi-conductor worker",
    parameters: Type.Object({
      name: Type.String({ description: "Worker name" }),
      task: Type.String({ description: "Task text" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const result = await runWorkerForRepo(ctx.cwd, params.name, params.task);
      const summary = result.finalText ?? result.errorMessage ?? "Run completed without a final assistant summary";
      return {
        content: [
          { type: "text", text: `ran worker ${result.workerName}: outcome=${result.status} result=${summary}` },
        ],
        details: {
          workerName: result.workerName,
          status: result.status,
          finalText: result.finalText,
          errorMessage: result.errorMessage,
          sessionId: result.sessionId,
        },
      };
    },
  });

  pi.registerTool({
    name: "conductor_lifecycle_update",
    label: "Conductor Lifecycle Update",
    description: "Update a named pi-conductor worker lifecycle state",
    parameters: Type.Object({
      name: Type.String({ description: "Worker name" }),
      lifecycle: Type.Union([
        Type.Literal("idle"),
        Type.Literal("running"),
        Type.Literal("blocked"),
        Type.Literal("ready_for_pr"),
        Type.Literal("done"),
      ]),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const worker = updateWorkerLifecycleForRepo(ctx.cwd, params.name, params.lifecycle);
      return {
        content: [{ type: "text", text: `updated worker ${worker.name} state to ${worker.lifecycle}` }],
        details: { workerId: worker.workerId, lifecycle: worker.lifecycle },
      };
    },
  });

  pi.registerTool({
    name: "conductor_commit",
    label: "Conductor Commit",
    description: "Commit all current worker worktree changes with a supplied commit message",
    parameters: Type.Object({
      name: Type.String({ description: "Worker name" }),
      message: Type.String({ description: "Commit message" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const worker = commitWorkerForRepo(ctx.cwd, params.name, params.message);
      return {
        content: [{ type: "text", text: `committed worker ${worker.name}: ${params.message}` }],
        details: { workerId: worker.workerId, commitSucceeded: worker.pr.commitSucceeded },
      };
    },
  });

  pi.registerTool({
    name: "conductor_push",
    label: "Conductor Push",
    description: "Push a worker branch to origin",
    parameters: Type.Object({
      name: Type.String({ description: "Worker name" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const worker = pushWorkerForRepo(ctx.cwd, params.name);
      return {
        content: [{ type: "text", text: `pushed worker ${worker.name} on branch ${worker.branch}` }],
        details: { workerId: worker.workerId, pushSucceeded: worker.pr.pushSucceeded },
      };
    },
  });

  pi.registerTool({
    name: "conductor_pr_create",
    label: "Conductor PR Create",
    description: "Create a GitHub pull request for a worker branch",
    parameters: Type.Object({
      name: Type.String({ description: "Worker name" }),
      title: Type.String({ description: "PR title" }),
      body: Type.Optional(Type.String({ description: "Optional PR body" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const worker = createWorkerPrForRepo(ctx.cwd, params.name, params.title, params.body);
      return {
        content: [{ type: "text", text: `created PR for ${worker.name}: ${worker.pr.url}` }],
        details: { workerId: worker.workerId, pr: worker.pr },
      };
    },
  });
}
