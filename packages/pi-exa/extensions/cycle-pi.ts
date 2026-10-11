/** Opt-in Pi cycle wiring; not installed by the MCP adapter. */
import { join } from "node:path";
import { type ExtensionAPI, type ExtensionContext, getAgentDir } from "@earendil-works/pi-coding-agent";
import type { PiToolRegistration } from "@feniix/bridgekit/pi";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { EXA_RATE_PROFILE } from "./research-accounting.js";
import { assertArtifactTarget, executionPlanSchema, ResearchArtifactError } from "./research-artifacts.js";
import { createResearchCycles, type ResearchCycle, type ResearchCycles } from "./research-cycles.js";
import { createResearchPlanner } from "./research-planner.js";
import { exaResearchStepParams, exaResearchSummaryParams } from "./schemas.js";

const targetProperties = {
  cycleId: Type.Optional(Type.String()),
  expectedRevision: Type.Optional(Type.Integer({ minimum: 0 })),
};
const referenceProperties = {
  ...targetProperties,
  artifactHash: Type.Optional(Type.String()),
};
const referenceParams = Type.Object(referenceProperties, { additionalProperties: false });
const stepParams = Type.Object(
  {
    ...exaResearchStepParams.properties,
    ...targetProperties,
    executionPlan: Type.Optional(executionPlanSchema),
  },
  { additionalProperties: false },
);
const summaryParams = Type.Object(
  {
    ...exaResearchSummaryParams.properties,
    ...referenceProperties,
  },
  { additionalProperties: false },
);

function view(record: ResearchCycle) {
  const { owner: _owner, ...visible } = record;
  return { ...visible, ...createResearchPlanner(record.plan).getStatus() };
}

function result(details: Record<string, unknown>, text = JSON.stringify(details, null, 2), isError = false) {
  return { content: [{ type: "text" as const, text }], details, isError };
}

function warning(record: ResearchCycle) {
  return record.status === "running" ||
    record.status === "unknown" ||
    record.attempts.some(
      (attempt) => "status" in attempt && (attempt.status === "running" || attempt.status === "unknown"),
    )
    ? " Outstanding/unknown execution remains; archive does not cancel it or clear its liability."
    : "";
}

export function cyclePiRegistration(pi: ExtensionAPI): PiToolRegistration {
  const controllers = new Map<string, Promise<ResearchCycles>>();
  const get = (ctx: ExtensionContext) => {
    const key = JSON.stringify([ctx.cwd, ctx.sessionManager.getSessionId()]);
    let controller = controllers.get(key);
    if (!controller) {
      controller = createResearchCycles({
        root: join(getAgentDir(), "research-cycles"),
        cwd: ctx.cwd,
        sessionId: ctx.sessionManager.getSessionId(),
      });
      controllers.set(key, controller);
    }
    return controller;
  };
  const detach = async () => {
    const pending = [...controllers.values()];
    controllers.clear();
    const outcomes = await Promise.allSettled(pending.map(async (controller) => (await controller).detach()));
    const errors = outcomes.flatMap((outcome) => (outcome.status === "rejected" ? [outcome.reason] : []));
    if (errors.length) throw new AggregateError(errors, "Cycle detached locally; ownership release failed.");
  };
  pi.on("session_start", detach);
  pi.on("session_before_switch", detach);
  pi.on("session_before_fork", detach);
  pi.on("session_tree", detach);
  pi.on("session_shutdown", detach);

  pi.registerCommand("exa-research", {
    description:
      "Manage durable research cycles: start <topic>, list, resume <id>, archive [id]. Paid cycle work remains gated.",
    handler: async (args, ctx) => {
      try {
        const match = /^(\S+)(?:\s+([\s\S]*))?$/.exec(args.trim());
        const action = match?.[1];
        const value = match?.[2]?.trim() ?? "";
        const cycles = await get(ctx);
        let text: string;
        switch (action) {
          case "start":
            text = JSON.stringify(view(await cycles.start(value)), null, 2);
            break;
          case "list": {
            const found = await cycles.discover();
            text = JSON.stringify(
              [...found.cycles.map(view), ...found.unreadableCycleIds.map((id) => ({ id, unreadable: true }))],
              null,
              2,
            );
            break;
          }
          case "resume": {
            const record = await cycles.resume(value);
            text = JSON.stringify(view(record), null, 2) + warning(record);
            break;
          }
          case "archive": {
            const record = await cycles.archive(value || undefined);
            text = `Archived ${record.id}.${warning(record)}`;
            break;
          }
          case "approve": {
            const approval = /^(\S+)\s+(\d+(?:\.\d{1,6})?)$/.exec(value);
            if (!approval) throw new Error("Use approve <cycle-id> <total-dollar-ceiling>; no grant was issued.");
            const approved = await cycles.grantBudget(approval[1], Number(approval[2]), [
              "web_search_exa",
              "web_fetch_exa",
              "web_find_similar_exa",
              "web_search_advanced_exa",
            ]);
            text = `Recorded total lifetime Exa ceiling. Estimates are not billing caps; unsupported pricing remains gated.\n${JSON.stringify(EXA_RATE_PROFILE)}\n${JSON.stringify(view(approved), null, 2)}`;
            break;
          }
          default:
            throw new Error("Use /exa-research start <topic>, list, resume <id>, or archive [id].");
        }
        ctx.ui.notify(text, "info");
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
      }
    },
  });

  return {
    registerTool(tool) {
      const paid = tool.name.startsWith("web_");
      pi.registerTool({
        ...tool,
        ...(tool.name === "exa_research_step"
          ? {
              parameters: stepParams,
              description:
                "Update the active durable plan. executionPlan fields replace their whole persisted field; omitted fields remain unchanged. Set a goal, explicit selectedEvidence source IDs/labels, optional input.data/exclusion processing rows, draft-07 root-object taskSchema and execution controls before preview. This does not approve or dispatch work.",
            }
          : {}),
        ...(tool.name === "exa_research_summary"
          ? {
              parameters: summaryParams,
              description:
                "Preview the versioned compiled research request with mode execution_plan or payload; brief/source_pack inspect curated planner facts. Compile errors name fields to fix. Artifacts do not authorize paid work.",
            }
          : {}),
        ...(tool.name === "exa_research_reset"
          ? {
              description:
                "Detach and archive the active durable research cycle; retain history, attempts, grants and liabilities. Does not cancel remote work.",
            }
          : {}),
        ...(paid
          ? {
              parameters: Type.Evaluate(
                Type.Intersect([
                  tool.name === "web_research_exa" ? Type.Omit(tool.parameters, ["query"]) : tool.parameters,
                  Type.Object({
                    researchMode: Type.Optional(Type.Union([Type.Literal("active"), Type.Literal("standalone")])),
                    ...targetProperties,
                    ...(tool.name === "web_research_exa"
                      ? {
                          query: Type.Optional(Type.String({ minLength: 1 })),
                          artifactHash: Type.Optional(Type.String()),
                        }
                      : {}),
                  }),
                ]),
              ),
            }
          : {}),
        async execute(id, params, signal, onUpdate, ctx) {
          try {
            const cycles = await get(ctx);
            const explicitStandalone =
              paid &&
              typeof params === "object" &&
              params !== null &&
              Reflect.get(params, "researchMode") === "standalone";
            const record = explicitStandalone ? undefined : await cycles.status();
            if (paid) {
              if (typeof params !== "object" || params === null) throw new Error("Invalid tool arguments.");
              const { researchMode, cycleId, expectedRevision, artifactHash, ...standalone } = params as Record<
                string,
                unknown
              >;
              if (researchMode !== undefined && researchMode !== "active" && researchMode !== "standalone") {
                throw new Error("Invalid researchMode.");
              }
              const reference = { cycleId, expectedRevision, artifactHash };
              if (!Value.Check(referenceParams, reference)) throw new Error("Invalid artifact reference.");
              if (!record && (cycleId !== undefined || expectedRevision !== undefined))
                throw new Error("No active research cycle.");
              if (researchMode === "active" && !record) throw new Error("No active research cycle.");
              if (record && researchMode !== "standalone") {
                if (tool.name === "web_research_exa") {
                  await cycles.preview({ ...reference, executionFields: standalone });
                } else {
                  assertArtifactTarget(record, reference);
                }
                throw new Error("Integrated paid research is not available in this slice; no request was dispatched.");
              }
              if (record) assertArtifactTarget(record, reference);
              if (artifactHash !== undefined) throw new Error("Artifact references require active-cycle research.");
              const metadata = standalone.metadata;
              const attributedCycleId =
                typeof metadata === "object" && metadata !== null && "cycleId" in metadata
                  ? metadata.cycleId
                  : undefined;
              if (standalone.previousRunId !== undefined && typeof standalone.previousRunId !== "string")
                throw new Error("Invalid previousRunId.");
              if (attributedCycleId !== undefined || standalone.previousRunId !== undefined) {
                const saved = await cycles.list();
                if (saved.some((cycle) => cycle.id === attributedCycleId)) {
                  throw new Error("Attributed cycle requests cannot be dispatched as unrelated standalone work.");
                }
                if (
                  saved.some((cycle) =>
                    cycle.attempts.some((attempt) => "runId" in attempt && attempt.runId === standalone.previousRunId),
                  )
                ) {
                  throw new Error("Recorded cycle attempts cannot be continued as unrelated standalone work.");
                }
              }
              if (!Value.Check(tool.parameters, standalone)) throw new Error("Invalid standalone tool arguments.");
              return tool.execute(id, standalone, signal, onUpdate, ctx);
            }
            if (!record) throw new Error("No active research cycle. Use /exa-research start or resume.");
            switch (tool.name) {
              case "exa_research_step":
                if (!Value.Check(stepParams, params)) throw new Error("Invalid research step arguments.");
                {
                  const updated = await cycles.recordStep(params);
                  return result({ ...updated, cycle: view(updated.cycle) });
                }
              case "exa_research_status":
                return result(view(record));
              case "exa_research_summary":
                if (!Value.Check(summaryParams, params)) throw new Error("Invalid research summary arguments.");
                if (params.mode === undefined || params.mode === "payload" || params.mode === "execution_plan") {
                  const artifact = await cycles.preview(params);
                  return result({ artifact, canExecute: false });
                }
                {
                  const current = await cycles.status(params);
                  if (!current) throw new Error("No active research cycle. Use /exa-research start or resume.");
                  return result(
                    view(current),
                    `Cycle: ${current.id}\nRevision: ${current.revision}\nStatus: ${current.status}\n${createResearchPlanner(current.plan).getSummary(params)}`,
                  );
                }
              case "exa_research_reset": {
                const archived = await cycles.archive();
                return result(view(archived), `Archived ${archived.id}.${warning(archived)}`);
              }
              default:
                return tool.execute(id, params, signal, onUpdate, ctx);
            }
          } catch (error) {
            return result(
              error instanceof ResearchArtifactError ? { issues: error.issues } : {},
              error instanceof Error ? error.message : String(error),
              true,
            );
          }
        },
      });
    },
  };
}
