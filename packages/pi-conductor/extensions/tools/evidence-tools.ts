import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import * as conductor from "../conductor.js";
import {
  acceptedPurposeValues,
  evidenceBundlePurposeSchema as buildEvidenceBundlePurposeSchema,
  readinessPurposeSchema as buildReadinessPurposeSchema,
  EVIDENCE_BUNDLE_PURPOSES,
  isEvidenceBundlePurpose,
  isReadinessPurpose,
  READINESS_PURPOSES,
} from "../purpose-values.js";
import * as storage from "../storage.js";

const evidenceBundlePurposeDescription = `Purpose of the evidence bundle. Valid values: ${acceptedPurposeValues(EVIDENCE_BUNDLE_PURPOSES)}. Use task_review for task review evidence, pr_readiness for PR publication readiness, or handoff for general handoff/human review. Default: task_review. If invalid, retry with one of these values.`;
const readinessPurposeDescription = `Purpose of the readiness check. Valid values: ${acceptedPurposeValues(READINESS_PURPOSES)}. Use task_review for task review readiness or pr_readiness for PR publication readiness. If invalid, retry with one of these values.`;
const evidenceBundlePurposeSchema = buildEvidenceBundlePurposeSchema(evidenceBundlePurposeDescription);
const readinessPurposeSchema = buildReadinessPurposeSchema(readinessPurposeDescription);

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
      const text =
        result.diagnostic && result.content
          ? `${result.content}\n\nDiagnostic: ${result.diagnostic}`
          : (result.content ?? result.diagnostic ?? "no content");
      return {
        content: [{ type: "text", text }],
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
    description: `Build a task/worker-scoped evidence bundle for review or PR readiness. purpose values: ${acceptedPurposeValues(EVIDENCE_BUNDLE_PURPOSES)}. Default: task_review. If invalid, retry with one of these values.`,
    parameters: Type.Object({
      workerId: Type.Optional(Type.String()),
      workerName: Type.Optional(Type.String()),
      objectiveId: Type.Optional(Type.String()),
      taskId: Type.Optional(Type.String()),
      runId: Type.Optional(Type.String()),
      purpose: Type.Optional(evidenceBundlePurposeSchema),
      includeEvents: Type.Optional(Type.Boolean()),
      persistArtifact: Type.Optional(Type.Boolean()),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (params.purpose !== undefined && !isEvidenceBundlePurpose(params.purpose)) {
        throw new Error(
          `Invalid purpose. Accepted values: ${acceptedPurposeValues(EVIDENCE_BUNDLE_PURPOSES)}. Default: task_review.`,
        );
      }
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
    description: `Evaluate whether a task or worker is ready for review or PR publication. purpose values: ${acceptedPurposeValues(READINESS_PURPOSES)}. If invalid, retry with one of these values.`,
    parameters: Type.Object({
      workerId: Type.Optional(Type.String()),
      workerName: Type.Optional(Type.String()),
      taskId: Type.Optional(Type.String()),
      purpose: readinessPurposeSchema,
      requireCompletionReport: Type.Optional(Type.Boolean()),
      requireTestEvidence: Type.Optional(Type.Boolean()),
      requireNoOpenGates: Type.Optional(Type.Boolean()),
      requireCommit: Type.Optional(Type.Boolean()),
      requirePush: Type.Optional(Type.Boolean()),
      requireApprovedReadyForPrGate: Type.Optional(Type.Boolean()),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (!isReadinessPurpose(params.purpose)) {
        throw new Error(`Invalid purpose. Accepted values: ${acceptedPurposeValues(READINESS_PURPOSES)}.`);
      }
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
