import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import * as conductor from "../conductor.js";

const schedulerPolicySchema = Type.Union([Type.Literal("safe"), Type.Literal("execute")]);
export function registerObjectiveTools(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "conductor_list_objectives",
    label: "Conductor List Objectives",
    description: "List parent-level conductor objectives that group durable tasks and evidence",
    parameters: Type.Object({
      status: Type.Optional(Type.String({ description: "Optional objective status filter" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const run = conductor.getOrCreateRunForRepo(ctx.cwd);
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
      const bundle = conductor.buildEvidenceBundleForRepo(ctx.cwd, {
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
      const objective = conductor.createObjectiveForRepo(ctx.cwd, params);
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
      const objective = conductor.updateObjectiveForRepo(ctx.cwd, params);
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
      const objective = conductor.refreshObjectiveStatusForRepo(ctx.cwd, params.objectiveId);
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
      const result = conductor.planObjectiveForRepo(ctx.cwd, params);
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
      const objective = conductor.linkTaskToObjectiveForRepo(ctx.cwd, params.objectiveId, params.taskId);
      return {
        content: [{ type: "text", text: `linked task ${params.taskId} to objective ${params.objectiveId}` }],
        details: { objective },
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
      const result = await conductor.scheduleObjectiveForRepo(ctx.cwd, params, _signal);
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
    name: "conductor_objective_dag",
    label: "Conductor Objective DAG",
    description: "Summarize objective task dependency batches for safe sequencing and parallelism",
    parameters: Type.Object({
      objectiveId: Type.String({ description: "Objective ID" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const dag = conductor.buildObjectiveDagForRepo(ctx.cwd, params.objectiveId);
      return {
        content: [{ type: "text", text: `objective ${dag.objectiveId}: ${dag.batches.length} batches` }],
        details: { dag },
      };
    },
  });
}
