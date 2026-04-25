import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { inspectConductorBackends } from "./backends.js";
import { runConductorCommand } from "./commands.js";
import {
  assessTaskForRepo,
  assignTaskForRepo,
  buildBlockingDiagnosisForRepo,
  buildEvidenceBundleForRepo,
  buildObjectiveDagForRepo,
  buildProjectBriefForRepo,
  buildResourceTimelineForRepo,
  buildTaskBriefForRepo,
  cancelTaskRunForRepo,
  checkReadinessForRepo,
  commitWorkerForRepo,
  createGateForRepo,
  createObjectiveForRepo,
  createTaskForRepo,
  createWorkerForRepo,
  createWorkerPrForRepo,
  delegateTaskForRepo,
  getNextActionsForRepo,
  getOrCreateRunForRepo,
  linkTaskToObjectiveForRepo,
  planObjectiveForRepo,
  prepareHumanReviewForRepo,
  pushWorkerForRepo,
  reconcileProjectForRepo,
  reconcileWorkerHealth,
  recoverWorkerForRepo,
  refreshObjectiveStatusForRepo,
  refreshWorkerSummaryForRepo,
  removeWorkerForRepo,
  resolveGateForRepo,
  resolveGateFromTrustedHumanForRepo,
  resumeWorkerForRepo,
  retryTaskForRepo,
  runNextActionForRepo,
  runTaskForRepo,
  runWorkerForRepo,
  scheduleObjectiveForRepo,
  schedulerTickForRepo,
  startTaskRunForRepo,
  updateObjectiveForRepo,
  updateTaskForRepo,
  updateWorkerLifecycleForRepo,
  updateWorkerTaskForRepo,
} from "./conductor.js";
import { deriveProjectKey } from "./project-key.js";
import { formatRunStatus } from "./status.js";
import {
  createEmptyRun,
  queryConductorArtifacts,
  queryConductorEvents,
  readArtifactContentForRepo,
  readRun,
  writeRun,
} from "./storage.js";

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

const schedulerPolicySchema = Type.Union([Type.Literal("safe"), Type.Literal("execute")]);

function shouldRegisterLegacyWorkerTools(): boolean {
  return process.env.PI_CONDUCTOR_ENABLE_LEGACY_WORKER_TOOLS === "1";
}

type HumanGateDashboardAction = "packet" | "approve" | "reject" | "cancel";

type HumanGateReview = {
  prompt: string;
  dashboardLines: string[];
};

function buildHumanGateReview(cwd: string, gateId: string): HumanGateReview {
  const run = getOrCreateRunForRepo(cwd);
  const gate = run.gates.find((entry) => entry.gateId === gateId);
  if (!gate) return { prompt: `Gate not found: ${gateId}`, dashboardLines: [`Gate not found: ${gateId}`] };
  const refs = gate.resourceRefs;
  const evidence = buildEvidenceBundleForRepo(cwd, { ...refs, purpose: "handoff", includeEvents: true });
  const timeline = buildResourceTimelineForRepo(cwd, { ...refs, gateId, limit: 10, includeArtifacts: true });
  const review = prepareHumanReviewForRepo(cwd, { objectiveId: refs.objectiveId, taskId: refs.taskId });
  const readiness =
    gate.operation === "create_worker_pr" || gate.type === "ready_for_pr"
      ? checkReadinessForRepo(cwd, { ...refs, purpose: "pr_readiness" })
      : refs.taskId
        ? checkReadinessForRepo(cwd, { ...refs, purpose: "task_review" })
        : null;
  const readinessText = readiness
    ? `${readiness.status}: blockers=${readiness.blockers.length} warnings=${readiness.warnings.length}`
    : "not applicable";
  const eventLines = timeline.events.slice(-10).map((event) => `#${event.sequence} ${event.type}`);
  const reviewPreview = review.markdown.split("\n").slice(0, 8);
  const dashboardLines = [
    "Conductor Gate Approval",
    `Gate: ${gate.gateId}`,
    `Type: ${gate.type}`,
    `Operation: ${gate.operation}`,
    `Decision: ${gate.requestedDecision}`,
    `Readiness: ${readinessText}`,
    `Evidence: tasks=${evidence.tasks.length} runs=${evidence.runs.length} gates=${evidence.gates.length} artifacts=${evidence.artifacts.length}`,
    evidence.pr?.url ? `PR: ${evidence.pr.url}` : null,
    eventLines.length > 0 ? `Recent: ${eventLines.slice(-3).join(" | ")}` : "Recent: no recent events",
    "",
    "Review Packet Preview",
    ...reviewPreview,
  ].filter((line): line is string => line !== null);
  const prompt = [
    `Gate ${gate.gateId}`,
    `Type: ${gate.type}`,
    `Status: ${gate.status}`,
    `Operation: ${gate.operation}`,
    `Requested decision: ${gate.requestedDecision}`,
    `Refs: ${JSON.stringify(gate.resourceRefs)}`,
    gate.targetRevision ? `Target revision: ${gate.targetRevision}` : null,
    gate.expiresAt ? `Expires: ${gate.expiresAt}` : null,
    "",
    "Readiness",
    readinessText,
    "",
    "Evidence",
    `tasks=${evidence.tasks.length} runs=${evidence.runs.length} gates=${evidence.gates.length} artifacts=${evidence.artifacts.length}`,
    evidence.pr?.url ? `pr=${evidence.pr.url}` : null,
    "",
    "Timeline",
    eventLines.join("\n") || "no recent events",
    "",
    "Review Packet",
    review.markdown,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
  return { prompt, dashboardLines };
}

function truncatePlainLine(line: string, width: number): string {
  if (width <= 0) return "";
  return line.length > width ? `${line.slice(0, Math.max(0, width - 1))}…` : line;
}

async function chooseHumanGateAction(
  ui: {
    custom?: <T>(
      factory: (
        tui: { requestRender: () => void },
        theme: unknown,
        keybindings: unknown,
        done: (value: T) => void,
      ) => unknown,
      options?: unknown,
    ) => Promise<T | undefined> | T | undefined;
    select?: (message: string, options: string[]) => Promise<string | undefined> | string | undefined;
  },
  review: HumanGateReview,
): Promise<HumanGateDashboardAction | null> {
  if (ui.custom) {
    const action = await ui.custom<HumanGateDashboardAction>((tui, theme, _keybindings, done) => {
      const themeLike = theme as { fg?: (color: string, text: string) => string; bold?: (text: string) => string };
      const fg = (color: string, text: string) => themeLike.fg?.(color, text) ?? text;
      const bold = (text: string) => themeLike.bold?.(text) ?? text;
      const actions: Array<{ value: HumanGateDashboardAction; label: string; description: string }> = [
        { value: "packet", label: "Open review packet", description: "Inspect the full markdown review packet" },
        { value: "approve", label: "Approve gate", description: "Allow the gated operation to proceed" },
        { value: "reject", label: "Reject gate", description: "Block the gated operation" },
        { value: "cancel", label: "Cancel", description: "Leave the gate open" },
      ];
      let selected = 0;
      return {
        render(width: number): string[] {
          const plainLines = [
            "Conductor Gate Approval Dashboard",
            "",
            ...review.dashboardLines,
            "",
            "Decision",
            ...actions.map((item, index) => {
              const prefix = index === selected ? "› " : "  ";
              return `${prefix}${item.label} — ${item.description}`;
            }),
            "",
            "↑↓ navigate • enter choose • esc cancel",
          ];
          return plainLines.map((line, index) => {
            const truncated = truncatePlainLine(line, width);
            if (index === 0) return fg("accent", bold(truncated));
            if (truncated === "Decision" || truncated.startsWith("↑↓")) return fg("dim", truncated);
            if (truncated.startsWith("› ")) return fg("accent", truncated);
            return truncated;
          });
        },
        handleInput(data: string): void {
          if (data === "\u001b[A" || data === "k") selected = (selected + actions.length - 1) % actions.length;
          if (data === "\u001b[B" || data === "j") selected = (selected + 1) % actions.length;
          if (data === "\r" || data === "\n") done(actions[selected]?.value ?? "cancel");
          if (data === "\u001b" || data === "\u0003") done("cancel");
          tui.requestRender();
        },
        invalidate(): void {},
      };
    });
    return action ?? null;
  }

  const decision = await ui.select?.(review.prompt, ["Open review packet", "Approve gate", "Reject gate", "Cancel"]);
  if (decision === "Open review packet") return "packet";
  if (decision === "Approve gate") return "approve";
  if (decision === "Reject gate") return "reject";
  return decision ? "cancel" : null;
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
      const trimmed = args.trim();
      const humanApproval = trimmed.match(/^human\s+(?:approve|decide)\s+gate\s+(\S+)(?:\s+(.+))?$/);
      if (humanApproval) {
        const gateId = humanApproval[1];
        if (!ctx.hasUI) {
          console.log("error: trusted human gate approval requires interactive UI");
          return;
        }
        const run = getOrCreateRunForRepo(ctx.cwd);
        const gate = run.gates.find((entry) => entry.gateId === gateId);
        if (!gate) {
          ctx.ui.notify(`gate not found: ${gateId}`, "error");
          return;
        }
        const review = buildHumanGateReview(ctx.cwd, gateId);
        const ui = ctx.ui as unknown as {
          custom?: <T>(
            factory: (
              tui: { requestRender: () => void },
              theme: unknown,
              keybindings: unknown,
              done: (value: T) => void,
            ) => unknown,
            options?: unknown,
          ) => Promise<T | undefined> | T | undefined;
          select?: (message: string, options: string[]) => Promise<string | undefined> | string | undefined;
          editor?: (title: string, text: string) => Promise<string | undefined> | string | undefined;
          input?: (message: string, placeholder?: string) => Promise<string | undefined> | string | undefined;
          notify: typeof ctx.ui.notify;
        };
        let action = await chooseHumanGateAction(ui, review);
        while (action === "packet") {
          await ui.editor?.("Conductor gate review packet", review.prompt);
          action = await chooseHumanGateAction(ui, review);
        }
        if (!action || action === "cancel") {
          ctx.ui.notify(`left gate ${gateId} open`, "info");
          return;
        }
        const status = action === "reject" ? "rejected" : "approved";
        const defaultReason = status === "approved" ? "Approved from pi conductor UI" : "Rejected from pi conductor UI";
        const reason =
          humanApproval[2]?.trim() ||
          (await ui.input?.("Reason for this gate decision", defaultReason)) ||
          defaultReason;
        const humanId = `ui:${process.env.USER ?? "local-human"}`;
        const resolved = resolveGateFromTrustedHumanForRepo(ctx.cwd, {
          gateId,
          status,
          humanId,
          resolutionReason: reason,
        });
        ctx.ui.notify(`${status} gate ${resolved.gateId} as trusted human`, "info");
        return;
      }
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
    name: "conductor_list_objectives",
    label: "Conductor List Objectives",
    description: "List parent-level conductor objectives that group durable tasks and evidence",
    parameters: Type.Object({
      status: Type.Optional(Type.String({ description: "Optional objective status filter" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const run = getOrCreateRunForRepo(ctx.cwd);
      const objectives = run.objectives.filter((objective) => !params.status || objective.status === params.status);
      const text =
        objectives.length === 0
          ? "no conductor objectives"
          : objectives
              .map(
                (objective) =>
                  `${objective.title} [${objective.objectiveId}] status=${objective.status} tasks=${objective.taskIds.length}`,
              )
              .join("\n");
      return { content: [{ type: "text", text }], details: { objectives } };
    },
  });

  pi.registerTool({
    name: "conductor_get_objective",
    label: "Conductor Get Objective",
    description: "Get one objective with its task, run, gate, artifact, and event evidence bundle",
    parameters: Type.Object({
      objectiveId: Type.String({ description: "Objective ID" }),
      includeEvents: Type.Optional(Type.Boolean({ description: "Include matching event history" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const bundle = buildEvidenceBundleForRepo(ctx.cwd, {
        objectiveId: params.objectiveId,
        purpose: "handoff",
        includeEvents: params.includeEvents ?? true,
      });
      if (!bundle.objective) {
        return { content: [{ type: "text", text: `objective not found: ${params.objectiveId}` }], details: {} };
      }
      return {
        content: [
          {
            type: "text",
            text: `${bundle.objective.title} [${bundle.objective.objectiveId}] status=${bundle.objective.status} tasks=${bundle.tasks.length} runs=${bundle.runs.length}`,
          },
        ],
        details: { bundle },
      };
    },
  });

  pi.registerTool({
    name: "conductor_create_objective",
    label: "Conductor Create Objective",
    description: "Create a parent-level conductor objective for coordinating multiple tasks",
    parameters: Type.Object({
      title: Type.String({ description: "Objective title" }),
      prompt: Type.String({ description: "Objective prompt/goal" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const objective = createObjectiveForRepo(ctx.cwd, params);
      return {
        content: [{ type: "text", text: `created objective ${objective.title} [${objective.objectiveId}]` }],
        details: { objective },
      };
    },
  });

  pi.registerTool({
    name: "conductor_update_objective",
    label: "Conductor Update Objective",
    description: "Update objective title, prompt, status, or summary",
    parameters: Type.Object({
      objectiveId: Type.String({ description: "Objective ID" }),
      title: Type.Optional(Type.String()),
      prompt: Type.Optional(Type.String()),
      status: Type.Optional(
        Type.Union([
          Type.Literal("draft"),
          Type.Literal("active"),
          Type.Literal("blocked"),
          Type.Literal("needs_review"),
          Type.Literal("completed"),
          Type.Literal("canceled"),
        ]),
      ),
      summary: Type.Optional(Type.String()),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const objective = updateObjectiveForRepo(ctx.cwd, params);
      return {
        content: [{ type: "text", text: `updated objective ${objective.objectiveId}: status=${objective.status}` }],
        details: { objective },
      };
    },
  });

  pi.registerTool({
    name: "conductor_refresh_objective_status",
    label: "Conductor Refresh Objective Status",
    description: "Roll up linked task states into an objective status and summary",
    parameters: Type.Object({
      objectiveId: Type.String({ description: "Objective ID" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const objective = refreshObjectiveStatusForRepo(ctx.cwd, params.objectiveId);
      return {
        content: [
          {
            type: "text",
            text: `objective ${objective.objectiveId}: ${objective.status} — ${objective.summary ?? ""}`,
          },
        ],
        details: { objective },
      };
    },
  });

  pi.registerTool({
    name: "conductor_plan_objective",
    label: "Conductor Plan Objective",
    description: "Expand an objective into an ordered durable task plan created atomically",
    parameters: Type.Object({
      objectiveId: Type.String({ description: "Objective ID" }),
      tasks: Type.Array(
        Type.Object({
          title: Type.String({ description: "Task title" }),
          prompt: Type.String({ description: "Task prompt/body" }),
          dependsOn: Type.Optional(Type.Array(Type.String({ description: "Title or ID of a dependency task" }))),
        }),
      ),
      rationale: Type.Optional(Type.String({ description: "Why this task breakdown is appropriate" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const result = planObjectiveForRepo(ctx.cwd, params);
      return {
        content: [
          {
            type: "text",
            text: `planned objective ${result.objective.objectiveId}: created ${result.tasks.length} tasks`,
          },
        ],
        details: result,
      };
    },
  });

  pi.registerTool({
    name: "conductor_link_task_to_objective",
    label: "Conductor Link Task To Objective",
    description: "Link an existing task into a parent-level conductor objective",
    parameters: Type.Object({
      objectiveId: Type.String({ description: "Objective ID" }),
      taskId: Type.String({ description: "Task ID" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const objective = linkTaskToObjectiveForRepo(ctx.cwd, params.objectiveId, params.taskId);
      return {
        content: [{ type: "text", text: `linked task ${params.taskId} to objective ${params.objectiveId}` }],
        details: { objective },
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
    name: "conductor_run_next_action",
    label: "Conductor Run Next Action",
    description: "Safely execute the highest-priority non-human conductor next action when supported",
    parameters: Type.Object({
      objectiveId: Type.Optional(Type.String({ description: "Optional objective scope" })),
      policy: Type.Optional(schedulerPolicySchema),
      executeRuns: Type.Optional(Type.Boolean({ description: "Allow starting model/backend task execution" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const result = await runNextActionForRepo(ctx.cwd, params);
      return {
        content: [
          {
            type: "text",
            text: result.executed ? `executed ${result.action?.kind}` : `no action executed: ${result.reason}`,
          },
        ],
        details: result,
      };
    },
  });

  pi.registerTool({
    name: "conductor_schedule_objective",
    label: "Conductor Schedule Objective",
    description: "Assign and optionally execute currently runnable tasks from an objective DAG",
    parameters: Type.Object({
      objectiveId: Type.Optional(Type.String({ description: "Objective ID" })),
      objectiveIds: Type.Optional(Type.Array(Type.String({ description: "Objective IDs to consider" }))),
      maxConcurrency: Type.Optional(Type.Number({ description: "Maximum runnable tasks to schedule; defaults to 1" })),
      policy: Type.Optional(schedulerPolicySchema),
      executeRuns: Type.Optional(Type.Boolean({ description: "Also execute assigned runnable tasks" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const result = await scheduleObjectiveForRepo(ctx.cwd, params);
      return {
        content: [
          {
            type: "text",
            text: `scheduled objective ${result.objectiveId}: assigned=${result.assigned.length} executed=${result.executed.length} skipped=${result.skipped.length}`,
          },
        ],
        details: result,
      };
    },
  });

  pi.registerTool({
    name: "conductor_scheduler_tick",
    label: "Conductor Scheduler Tick",
    description: "Execute a bounded deterministic conductor scheduler tick over safe next actions",
    parameters: Type.Object({
      objectiveId: Type.Optional(Type.String({ description: "Optional objective scope" })),
      maxActions: Type.Optional(Type.Number({ description: "Maximum safe actions to execute; defaults to 1" })),
      maxRuns: Type.Optional(Type.Number({ description: "Maximum run_task actions to start in this tick" })),
      perObjectiveLimit: Type.Optional(Type.Number({ description: "Maximum selected actions per objective" })),
      fairness: Type.Optional(Type.Union([Type.Literal("priority"), Type.Literal("round_robin")])),
      policy: Type.Optional(schedulerPolicySchema),
      executeRuns: Type.Optional(
        Type.Boolean({ description: "Allow scheduler to start model/backend task execution" }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const result = await schedulerTickForRepo(ctx.cwd, params);
      return {
        content: [{ type: "text", text: `scheduler executed ${result.executed.length} action(s)` }],
        details: result,
      };
    },
  });

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
      const assessment = assessTaskForRepo(ctx.cwd, params);
      return {
        content: [{ type: "text", text: `task ${assessment.taskId}: ${assessment.verdict}` }],
        details: { assessment },
      };
    },
  });

  pi.registerTool({
    name: "conductor_read_artifact",
    label: "Conductor Read Artifact",
    description: "Safely read bounded content from a local conductor artifact ref",
    parameters: Type.Object({
      artifactId: Type.String({ description: "Artifact ID" }),
      maxBytes: Type.Optional(Type.Number({ description: "Maximum bytes to return; defaults to 8192" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const result = readArtifactContentForRepo(ctx.cwd, params.artifactId, { maxBytes: params.maxBytes });
      return {
        content: [{ type: "text", text: result.content ?? result.diagnostic ?? "no content" }],
        details: result,
      };
    },
  });

  pi.registerTool({
    name: "conductor_objective_dag",
    label: "Conductor Objective DAG",
    description: "Summarize objective task dependency batches for safe sequencing and parallelism",
    parameters: Type.Object({
      objectiveId: Type.String({ description: "Objective ID" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const dag = buildObjectiveDagForRepo(ctx.cwd, params.objectiveId);
      return {
        content: [{ type: "text", text: `objective ${dag.objectiveId}: ${dag.batches.length} batches` }],
        details: { dag },
      };
    },
  });

  pi.registerTool({
    name: "conductor_prepare_human_review",
    label: "Conductor Prepare Human Review",
    description: "Prepare a concise markdown packet for human review of an objective or task",
    parameters: Type.Object({
      objectiveId: Type.Optional(Type.String()),
      taskId: Type.Optional(Type.String()),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const packet = prepareHumanReviewForRepo(ctx.cwd, params);
      return { content: [{ type: "text", text: packet.markdown }], details: { packet } };
    },
  });

  pi.registerTool({
    name: "conductor_diagnose_blockers",
    label: "Conductor Diagnose Blockers",
    description: "Return exact blockers and safe next tool calls for an objective or task",
    parameters: Type.Object({
      objectiveId: Type.Optional(Type.String()),
      taskId: Type.Optional(Type.String()),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const diagnosis = buildBlockingDiagnosisForRepo(ctx.cwd, params);
      return { content: [{ type: "text", text: diagnosis.markdown }], details: { diagnosis } };
    },
  });

  pi.registerTool({
    name: "conductor_resource_timeline",
    label: "Conductor Resource Timeline",
    description: "Return chronological events and evidence for one conductor resource",
    parameters: Type.Object({
      objectiveId: Type.Optional(Type.String()),
      workerId: Type.Optional(Type.String()),
      taskId: Type.Optional(Type.String()),
      runId: Type.Optional(Type.String()),
      gateId: Type.Optional(Type.String()),
      artifactId: Type.Optional(Type.String()),
      limit: Type.Optional(Type.Number({ description: "Maximum events to include; defaults to 25, max 100" })),
      includeArtifacts: Type.Optional(Type.Boolean({ description: "Include matching artifact records" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const timeline = buildResourceTimelineForRepo(ctx.cwd, params);
      return { content: [{ type: "text", text: timeline.markdown }], details: { timeline } };
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
      const brief = buildTaskBriefForRepo(ctx.cwd, params);
      return { content: [{ type: "text", text: brief.markdown }], details: { brief } };
    },
  });

  pi.registerTool({
    name: "conductor_project_brief",
    label: "Conductor Project Brief",
    description: "Return an LLM-oriented markdown and structured brief of current conductor state",
    parameters: Type.Object({
      maxActions: Type.Optional(Type.Number({ description: "Maximum next actions to include; defaults to 5" })),
      recentEventLimit: Type.Optional(Type.Number({ description: "Recent events to include; defaults to 10, max 50" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const brief = buildProjectBriefForRepo(ctx.cwd, params);
      return { content: [{ type: "text", text: brief.markdown }], details: { brief } };
    },
  });

  pi.registerTool({
    name: "conductor_next_actions",
    label: "Conductor Next Actions",
    description: "Recommend prioritized parent-agent orchestration actions from current durable conductor state",
    parameters: Type.Object({
      maxActions: Type.Optional(Type.Number({ description: "Maximum actions to return; defaults to 10, max 25" })),
      includeLowPriority: Type.Optional(Type.Boolean({ description: "Include low-priority monitoring/no-op actions" })),
      includePrActions: Type.Optional(Type.Boolean({ description: "Include PR preparation recommendations" })),
      objectiveId: Type.Optional(Type.String({ description: "Limit recommendations to one objective and its tasks" })),
      includeHumanGateActions: Type.Optional(
        Type.Boolean({ description: "Include actions that require human gate decisions" }),
      ),
      reconcile: Type.Optional(
        Type.Boolean({ description: "Preview reconciliation before recommending actions; defaults to true" }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const recommendations = getNextActionsForRepo(ctx.cwd, params);
      const text = recommendations.actions.length
        ? recommendations.actions
            .map((action, index) => `${index + 1}. [${action.priority}] ${action.title}`)
            .join("\n")
        : `No conductor actions recommended: ${recommendations.summary.headline}`;
      return { content: [{ type: "text", text }], details: recommendations };
    },
  });

  pi.registerTool({
    name: "conductor_build_evidence_bundle",
    label: "Conductor Build Evidence Bundle",
    description: "Build a task/worker-scoped evidence bundle for review or PR readiness",
    parameters: Type.Object({
      workerId: Type.Optional(Type.String()),
      workerName: Type.Optional(Type.String()),
      objectiveId: Type.Optional(Type.String()),
      taskId: Type.Optional(Type.String()),
      runId: Type.Optional(Type.String()),
      purpose: Type.Optional(
        Type.Union([Type.Literal("task_review"), Type.Literal("pr_readiness"), Type.Literal("handoff")]),
      ),
      includeEvents: Type.Optional(Type.Boolean()),
      persistArtifact: Type.Optional(Type.Boolean()),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const bundle = buildEvidenceBundleForRepo(ctx.cwd, params);
      return {
        content: [
          {
            type: "text",
            text: `evidence bundle ${bundle.purpose}: tasks=${bundle.summary.taskCount} runs=${bundle.summary.runCount} artifacts=${bundle.summary.artifactCount} openGates=${bundle.summary.openGateCount}`,
          },
        ],
        details: { bundle },
      };
    },
  });

  pi.registerTool({
    name: "conductor_check_readiness",
    label: "Conductor Check Readiness",
    description: "Evaluate whether a task or worker is ready for review or PR publication",
    parameters: Type.Object({
      workerId: Type.Optional(Type.String()),
      workerName: Type.Optional(Type.String()),
      taskId: Type.Optional(Type.String()),
      purpose: Type.Union([Type.Literal("task_review"), Type.Literal("pr_readiness")]),
      requireCompletionReport: Type.Optional(Type.Boolean()),
      requireTestEvidence: Type.Optional(Type.Boolean()),
      requireNoOpenGates: Type.Optional(Type.Boolean()),
      requireCommit: Type.Optional(Type.Boolean()),
      requirePush: Type.Optional(Type.Boolean()),
      requireApprovedReadyForPrGate: Type.Optional(Type.Boolean()),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const readiness = checkReadinessForRepo(ctx.cwd, params);
      return {
        content: [
          {
            type: "text",
            text: `${readiness.purpose}: ${readiness.status} blockers=${readiness.blockers.length} warnings=${readiness.warnings.length}`,
          },
        ],
        details: { readiness },
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

  const artifactTypeSchema = Type.Union([
    Type.Literal("note"),
    Type.Literal("test_result"),
    Type.Literal("changed_files"),
    Type.Literal("log"),
    Type.Literal("completion_report"),
    Type.Literal("pr_evidence"),
    Type.Literal("other"),
  ]);

  pi.registerTool({
    name: "conductor_list_events",
    label: "Conductor List Events",
    description: "List durable conductor events with resource filters and bounded pagination",
    parameters: Type.Object({
      limit: Type.Optional(Type.Number({ description: "Maximum events to return; defaults to 20, max 100" })),
      afterSequence: Type.Optional(Type.Number({ description: "Exclusive sequence cursor" })),
      type: Type.Optional(Type.String({ description: "Event type filter" })),
      workerId: Type.Optional(Type.String()),
      taskId: Type.Optional(Type.String()),
      runId: Type.Optional(Type.String()),
      gateId: Type.Optional(Type.String()),
      artifactId: Type.Optional(Type.String()),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const page = queryConductorEvents(getOrCreateRunForRepo(ctx.cwd), params);
      const text =
        page.events.length === 0
          ? "no conductor events"
          : page.events.map((event) => `#${event.sequence} ${event.type} ${event.occurredAt}`).join("\n");
      return { content: [{ type: "text", text }], details: page };
    },
  });

  pi.registerTool({
    name: "conductor_list_artifacts",
    label: "Conductor List Artifacts",
    description: "List durable conductor artifacts with resource filters and bounded pagination",
    parameters: Type.Object({
      limit: Type.Optional(Type.Number({ description: "Maximum artifacts to return; defaults to 20, max 100" })),
      afterIndex: Type.Optional(Type.Number({ description: "Exclusive artifact index cursor" })),
      type: Type.Optional(artifactTypeSchema),
      workerId: Type.Optional(Type.String()),
      taskId: Type.Optional(Type.String()),
      runId: Type.Optional(Type.String()),
      gateId: Type.Optional(Type.String()),
      artifactId: Type.Optional(Type.String()),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const page = queryConductorArtifacts(getOrCreateRunForRepo(ctx.cwd), params);
      const text =
        page.artifacts.length === 0
          ? "no conductor artifacts"
          : page.artifacts.map((artifact) => `${artifact.artifactId} ${artifact.type} ${artifact.ref}`).join("\n");
      return { content: [{ type: "text", text }], details: page };
    },
  });

  pi.registerTool({
    name: "conductor_list_workers",
    label: "Conductor List Workers",
    description: "List durable pi-conductor workers for the current repository",
    parameters: Type.Object({
      includeArchived: Type.Optional(
        Type.Boolean({ description: "Include archived workers preserved for audit history" }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const run = getOrCreateRunForRepo(ctx.cwd);
      const workers = params.includeArchived ? [...run.workers, ...run.archivedWorkers] : run.workers;
      const text =
        workers.length === 0
          ? "no conductor workers"
          : workers.map((worker) => `${worker.name} [${worker.workerId}] state=${worker.lifecycle}`).join("\n");
      return { content: [{ type: "text", text }], details: { workers } };
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
      const run = getOrCreateRunForRepo(ctx.cwd);
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
      const run = getOrCreateRunForRepo(ctx.cwd);
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
    name: "conductor_list_runs",
    label: "Conductor List Runs",
    description: "List durable task run attempts for the current repository",
    parameters: Type.Object({
      taskId: Type.Optional(Type.String()),
      workerId: Type.Optional(Type.String()),
      status: Type.Optional(Type.String()),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const run = getOrCreateRunForRepo(ctx.cwd);
      const runs = run.runs.filter(
        (attempt) =>
          (!params.taskId || attempt.taskId === params.taskId) &&
          (!params.workerId || attempt.workerId === params.workerId) &&
          (!params.status || attempt.status === params.status),
      );
      const text =
        runs.length === 0
          ? "no conductor runs"
          : runs.map((attempt) => `${attempt.runId} task=${attempt.taskId} status=${attempt.status}`).join("\n");
      return { content: [{ type: "text", text }], details: { runs } };
    },
  });

  pi.registerTool({
    name: "conductor_list_gates",
    label: "Conductor List Gates",
    description: "List durable conductor gates for the current repository",
    parameters: Type.Object({
      taskId: Type.Optional(Type.String()),
      workerId: Type.Optional(Type.String()),
      status: Type.Optional(Type.String()),
      type: Type.Optional(Type.String()),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const run = getOrCreateRunForRepo(ctx.cwd);
      const gates = run.gates.filter(
        (gate) =>
          (!params.taskId || gate.resourceRefs.taskId === params.taskId) &&
          (!params.workerId || gate.resourceRefs.workerId === params.workerId) &&
          (!params.status || gate.status === params.status) &&
          (!params.type || gate.type === params.type),
      );
      const text =
        gates.length === 0
          ? "no conductor gates"
          : gates.map((gate) => `${gate.gateId} type=${gate.type} status=${gate.status}`).join("\n");
      return { content: [{ type: "text", text }], details: { gates } };
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
      objectiveId: Type.Optional(Type.String({ description: "Optional objective ID to link this task into" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const task = createTaskForRepo(ctx.cwd, params);
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
      const task = updateTaskForRepo(ctx.cwd, params);
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

  const gateTypeSchema = Type.Union([
    Type.Literal("needs_input"),
    Type.Literal("needs_review"),
    Type.Literal("approval_required"),
    Type.Literal("ready_for_pr"),
    Type.Literal("destructive_cleanup"),
  ]);
  const gateOperationSchema = Type.Union([
    Type.Literal("create_worker_pr"),
    Type.Literal("destructive_cleanup"),
    Type.Literal("resolve_blocker"),
    Type.Literal("generic"),
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
          objectiveId: Type.Optional(Type.String()),
        },
        { additionalProperties: false },
      ),
      operation: Type.Optional(gateOperationSchema),
      targetRevision: Type.Optional(
        Type.Number({ description: "Optional target resource revision this approval is bound to" }),
      ),
      expiresAt: Type.Optional(
        Type.String({ description: "Optional ISO timestamp after which the gate cannot be approved" }),
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
      actorId: Type.String({ description: "Identifier for the parent agent resolving the gate" }),
      actorType: Type.Optional(Type.Literal("parent_agent")),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const gate = resolveGateForRepo(ctx.cwd, {
        gateId: params.gateId,
        status: params.status,
        resolutionReason: params.resolutionReason,
        actor: { type: "parent_agent", id: params.actorId },
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
      backend: Type.Optional(Type.Union([Type.Literal("native"), Type.Literal("pi-subagents")])),
      allowFollowUpTasks: Type.Optional(
        Type.Boolean({ description: "Allow the child run to create scoped follow-up tasks" }),
      ),
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
    name: "conductor_cancel_task_run",
    label: "Conductor Cancel Task Run",
    description: "Cancel an active durable task run without marking the task complete",
    parameters: Type.Object({
      runId: Type.String({ description: "Run ID to cancel" }),
      reason: Type.String({ description: "Cancellation reason" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const project = cancelTaskRunForRepo(ctx.cwd, params);
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
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const retried = retryTaskForRepo(ctx.cwd, params);
      return {
        content: [{ type: "text", text: `retried task ${params.taskId} as run ${retried.run.runId}` }],
        details: retried,
      };
    },
  });

  pi.registerTool({
    name: "conductor_recover_worker",
    label: "Conductor Recover Worker",
    description: "Recover a broken conductor worker with missing worktree or session linkage",
    parameters: Type.Object({
      name: Type.String({ description: "Worker name" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const worker = await recoverWorkerForRepo(ctx.cwd, params.name);
      return {
        content: [{ type: "text", text: `recovered worker ${worker.name}: session=${worker.sessionFile}` }],
        details: { workerId: worker.workerId, sessionFile: worker.sessionFile, worktreePath: worker.worktreePath },
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

  if (shouldRegisterLegacyWorkerTools()) {
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
}
