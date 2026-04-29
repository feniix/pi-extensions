import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import * as backends from "../backends.js";
import * as conductor from "../conductor.js";

const schedulerPolicySchema = Type.Union([Type.Literal("safe"), Type.Literal("execute")]);

function formatNextActionText(
  action: { priority: string; title: string; toolCall: null | { name: string; params: Record<string, unknown> } },
  index: number,
): string {
  const toolText = action.toolCall ? ` — call ${action.toolCall.name}(${JSON.stringify(action.toolCall.params)})` : "";
  return `${index + 1}. [${action.priority}] ${action.title}${toolText}`;
}

export function registerProjectTools(pi: ExtensionAPI, findRepoRoot: (cwd: string) => string | null): void {
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
      const run = conductor.getOrCreateRunForRepo(repoRoot);
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
      const before = conductor.getOrCreateRunForRepo(ctx.cwd);
      const after = conductor.reconcileProjectForRepo(ctx.cwd, { dryRun: params.dryRun ?? false });
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
      const result = await conductor.runNextActionForRepo(ctx.cwd, params, _signal);
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
      const result = await conductor.schedulerTickForRepo(ctx.cwd, params, _signal);
      return {
        content: [{ type: "text", text: `scheduler executed ${result.executed.length} action(s)` }],
        details: result,
      };
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
      const brief = conductor.buildProjectBriefForRepo(ctx.cwd, params);
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
      const recommendations = conductor.getNextActionsForRepo(ctx.cwd, params);
      const text = recommendations.actions.length
        ? recommendations.actions.map(formatNextActionText).join("\n")
        : `No conductor actions recommended: ${recommendations.summary.headline}`;
      return { content: [{ type: "text", text }], details: recommendations };
    },
  });

  pi.registerTool({
    name: "conductor_backend_status",
    label: "Conductor Backend Status",
    description: "Inspect native/pi-subagents backend and worker runtime mode availability",
    parameters: Type.Object({}),
    async execute() {
      const backendStatus = backends.inspectConductorBackends();
      const runtimeStatus = backends.inspectConductorRuntimeModes();
      const text = [
        `native: available=${backendStatus.native.available}`,
        `pi-subagents: available=${backendStatus.piSubagents.available}${backendStatus.piSubagents.diagnostic ? ` (${backendStatus.piSubagents.diagnostic})` : ""}`,
        `runtime headless: available=${runtimeStatus.headless.available}`,
        `runtime tmux: available=${runtimeStatus.tmux.available}${runtimeStatus.tmux.diagnostic ? ` (${runtimeStatus.tmux.diagnostic})` : ""}`,
        `runtime iterm-tmux: available=${runtimeStatus["iterm-tmux"].available}${runtimeStatus["iterm-tmux"].diagnostic ? ` (${runtimeStatus["iterm-tmux"].diagnostic})` : ""}`,
      ].join("\n");
      return { content: [{ type: "text", text }], details: { ...backendStatus, runtimes: runtimeStatus } };
    },
  });
}
