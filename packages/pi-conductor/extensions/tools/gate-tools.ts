import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import * as conductor from "../conductor.js";
import { formatRunRuntimeSummary } from "../runtime-metadata.js";

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
export function registerGateTools(pi: ExtensionAPI): void {
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
      const run = conductor.getOrCreateRunForRepo(ctx.cwd);
      const runs = run.runs.filter(
        (attempt) =>
          (!params.taskId || attempt.taskId === params.taskId) &&
          (!params.workerId || attempt.workerId === params.workerId) &&
          (!params.status || attempt.status === params.status),
      );
      const text =
        runs.length === 0
          ? "no conductor runs"
          : runs
              .map(
                (attempt) =>
                  `${attempt.runId} task=${attempt.taskId} status=${attempt.status} ${formatRunRuntimeSummary(attempt.runtime)}`,
              )
              .join("\n");
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
      const run = conductor.getOrCreateRunForRepo(ctx.cwd);
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
      const gate = conductor.createGateForRepo(ctx.cwd, params);
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
      const gate = conductor.resolveGateForRepo(ctx.cwd, {
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
}
