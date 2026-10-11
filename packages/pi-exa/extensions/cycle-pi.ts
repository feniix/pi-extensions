/** Opt-in Pi cycle wiring; not installed by the MCP adapter. */
import { join } from "node:path";
import { type ExtensionAPI, type ExtensionContext, getAgentDir } from "@earendil-works/pi-coding-agent";
import type { PiToolRegistration } from "@feniix/bridgekit/pi";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { createResearchCycles, type ResearchCycle, type ResearchCycles } from "./research-cycles.js";
import { createResearchPlanner } from "./research-planner.js";
import { exaResearchStepParams, exaResearchSummaryParams } from "./schemas.js";

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
          case "list":
            text = JSON.stringify((await cycles.list()).map(view), null, 2);
            break;
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
          case "approve":
            throw new Error("Spending approval is not available yet; no grant was issued.");
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
                  tool.parameters,
                  Type.Object({
                    researchMode: Type.Optional(Type.Union([Type.Literal("active"), Type.Literal("standalone")])),
                    cycleId: Type.Optional(Type.String()),
                    expectedRevision: Type.Optional(Type.Integer({ minimum: 0 })),
                  }),
                ]),
              ),
            }
          : {}),
        async execute(id, params, signal, onUpdate, ctx) {
          try {
            const cycles = await get(ctx);
            const record = await cycles.status();
            if (paid) {
              if (typeof params !== "object" || params === null) throw new Error("Invalid tool arguments.");
              const { researchMode, cycleId, expectedRevision, ...standalone } = params as Record<string, unknown>;
              if (researchMode !== undefined && researchMode !== "active" && researchMode !== "standalone") {
                throw new Error("Invalid researchMode.");
              }
              if (cycleId !== undefined && cycleId !== record?.id) throw new Error("Active cycle ID mismatch.");
              if (expectedRevision !== undefined && expectedRevision !== record?.revision)
                throw new Error("Stale cycle revision.");
              if (researchMode === "active" && !record) throw new Error("No active research cycle.");
              if (record && researchMode !== "standalone") {
                throw new Error("Integrated paid research is not available in this slice; no request was dispatched.");
              }
              if (standalone.previousRunId !== undefined) {
                if (typeof standalone.previousRunId !== "string") throw new Error("Invalid previousRunId.");
                const saved = await cycles.list();
                if (
                  saved.some((cycle) =>
                    cycle.attempts.some((attempt) => "runId" in attempt && attempt.runId === standalone.previousRunId),
                  )
                ) {
                  throw new Error("Recorded cycle attempts cannot be continued as unrelated standalone work.");
                }
              }
              return tool.execute(id, standalone, signal, onUpdate, ctx);
            }
            if (!record) throw new Error("No active research cycle. Use /exa-research start or resume.");
            switch (tool.name) {
              case "exa_research_step":
                if (!Value.Check(exaResearchStepParams, params)) throw new Error("Invalid research step arguments.");
                {
                  const updated = await cycles.recordStep(params);
                  return result({ ...updated, cycle: view(updated.cycle) });
                }
              case "exa_research_status":
                return result(view(record));
              case "exa_research_summary":
                if (!Value.Check(exaResearchSummaryParams, params))
                  throw new Error("Invalid research summary arguments.");
                return result(
                  view(record),
                  `Cycle: ${record.id}\nRevision: ${record.revision}\nStatus: ${record.status}\n${createResearchPlanner(record.plan).getSummary(params)}`,
                );
              case "exa_research_reset": {
                const archived = await cycles.archive();
                return result(view(archived), `Archived ${archived.id}.${warning(archived)}`);
              }
              default:
                return tool.execute(id, params, signal, onUpdate, ctx);
            }
          } catch (error) {
            return result({}, error instanceof Error ? error.message : String(error), true);
          }
        },
      });
    },
  };
}
