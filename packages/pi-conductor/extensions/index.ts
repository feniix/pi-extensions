/* v8 ignore file -- extension registration glue is covered by command/tool runtime tests at service boundaries. */
import { execSync } from "node:child_process";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { runConductorCommand } from "./commands.js";
import { getOrCreateRunForRepo } from "./conductor.js";
import { openHumanGateQueueDashboard, resolveHumanGateDecision, toHumanGateDecisionUi } from "./human-gates.js";
import { registerConductorTools } from "./tools.js";

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

export default function conductorExtension(pi: ExtensionAPI) {
  pi.registerCommand("conductor", {
    description: "Manage pi-conductor workers and PR preparation",
    handler: async (args, ctx) => {
      const trimmed = args.trim();
      const humanDashboard = trimmed.match(/^human\s+dashboard$/);
      if (humanDashboard) {
        if (!ctx.hasUI) {
          throw new Error("trusted human gate dashboard requires interactive UI");
        }
        await openHumanGateQueueDashboard(ctx.cwd, toHumanGateDecisionUi(ctx.ui));
        return;
      }
      const humanQueue = trimmed.match(/^human\s+gates(?:\s+(.+))?$/);
      if (humanQueue) {
        if (!ctx.hasUI) {
          throw new Error("trusted human gate queue requires interactive UI");
        }
        const ui = toHumanGateDecisionUi(ctx.ui);
        await openHumanGateQueueDashboard(ctx.cwd, ui, { reason: humanQueue[1], once: true });
        return;
      }
      const humanApproval = trimmed.match(/^human\s+(?:approve|decide)\s+gate\s+(\S+)(?:\s+(.+))?$/);
      if (humanApproval) {
        const gateId = humanApproval[1];
        if (!ctx.hasUI) {
          throw new Error("trusted human gate approval requires interactive UI");
        }
        const run = getOrCreateRunForRepo(ctx.cwd);
        const gate = run.gates.find((entry) => entry.gateId === gateId);
        if (!gate) {
          ctx.ui.notify(`gate not found: ${gateId}`, "error");
          return;
        }
        try {
          await resolveHumanGateDecision(ctx.cwd, gateId, humanApproval[2], toHumanGateDecisionUi(ctx.ui));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          ctx.ui.notify(`gate ${gateId} changed before decision (${message})`, "error");
        }
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

  registerConductorTools(pi, findRepoRoot);
}
