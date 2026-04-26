import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import * as conductor from "../conductor.js";
import * as storage from "../storage.js";

const artifactTypeSchema = Type.Union([
  Type.Literal("note"),
  Type.Literal("test_result"),
  Type.Literal("changed_files"),
  Type.Literal("log"),
  Type.Literal("completion_report"),
  Type.Literal("pr_evidence"),
  Type.Literal("other"),
]);
export function registerEvidenceTools(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "conductor_read_artifact",
    label: "Conductor Read Artifact",
    description: "Safely read bounded content from a local conductor artifact ref",
    parameters: Type.Object({
      artifactId: Type.String({ description: "Artifact ID" }),
      maxBytes: Type.Optional(Type.Number({ description: "Maximum bytes to return; defaults to 8192" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const result = storage.readArtifactContentForRepo(ctx.cwd, params.artifactId, { maxBytes: params.maxBytes });
      return {
        content: [{ type: "text", text: result.content ?? result.diagnostic ?? "no content" }],
        details: result,
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
      const packet = conductor.prepareHumanReviewForRepo(ctx.cwd, params);
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
      const diagnosis = conductor.buildBlockingDiagnosisForRepo(ctx.cwd, params);
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
      const timeline = conductor.buildResourceTimelineForRepo(ctx.cwd, params);
      return { content: [{ type: "text", text: timeline.markdown }], details: { timeline } };
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
      const bundle = conductor.buildEvidenceBundleForRepo(ctx.cwd, params);
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
      const readiness = conductor.checkReadinessForRepo(ctx.cwd, params);
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
      const page = storage.queryConductorEvents(conductor.getOrCreateRunForRepo(ctx.cwd), params);
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
      const page = storage.queryConductorArtifacts(conductor.getOrCreateRunForRepo(ctx.cwd), params);
      const text =
        page.artifacts.length === 0
          ? "no conductor artifacts"
          : page.artifacts.map((artifact) => `${artifact.artifactId} ${artifact.type} ${artifact.ref}`).join("\n");
      return { content: [{ type: "text", text }], details: page };
    },
  });
}
