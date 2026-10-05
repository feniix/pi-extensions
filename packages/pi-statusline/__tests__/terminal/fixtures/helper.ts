import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function terminalSmokeHelper(pi: ExtensionAPI) {
  const stateFile = process.env.STATUSLINE_SMOKE_STATE;
  if (!stateFile) throw new Error("STATUSLINE_SMOKE_STATE is required");
  writeFileSync(stateFile, JSON.stringify({ pid: process.pid }));

  pi.registerProvider("statusline-smoke", {
    api: "statusline-smoke",
    baseUrl: "http://127.0.0.1:1",
    apiKey: "test-only-not-a-credential",
    models: [
      {
        id: "smoke-model",
        name: "Smoke Model",
        reasoning: true,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 10_000,
        maxTokens: 1_000,
      },
    ],
    streamSimple: () => {
      throw new Error("UNEXPECTED_SMOKE_MODEL_REQUEST");
    },
  });

  pi.registerCommand("smoke-resize", {
    description: "Resize the test PTY using the OS stty utility",
    handler: async (args, ctx) => {
      const width = Number(args);
      if (!Number.isInteger(width) || width < 20 || width > 200) throw new Error("Invalid smoke width");
      const resized = new Promise<void>((resolve) => {
        if (process.stdout.columns === width) resolve();
        else process.stdout.once("resize", resolve);
      });
      execFileSync("stty", ["cols", String(width), "rows", "30"], { stdio: [0, "ignore", "pipe"] });
      await resized;
      ctx.ui.setStatus("00-width", `W${process.stdout.columns}`);
    },
  });
  pi.registerCommand("smoke-status", {
    description: "Publish Unicode smoke-test extension statuses",
    handler: async (_args, ctx) => {
      ctx.ui.setStatus("smoke-a", "🧪 项目 e\u0301 — SMOKE READY");
      ctx.ui.setStatus("smoke-b", "SECOND STATUS");
    },
  });
  pi.registerCommand("smoke-clear", {
    description: "Remove smoke-test statuses",
    handler: async (_args, ctx) => {
      ctx.ui.setStatus("smoke-a", undefined);
      ctx.ui.setStatus("smoke-b", undefined);
    },
  });
  pi.registerCommand("smoke-prompt", {
    description: "Open a real extension confirmation prompt",
    handler: async (_args, ctx) => {
      await ctx.ui.confirm("SMOKE CONFIRM", "Inspect waiting activity, then dismiss.");
    },
  });
  pi.registerCommand("smoke-thinking", {
    description: "Change thinking effort without requesting a model response",
    handler: async () => {
      pi.setThinkingLevel("high");
    },
  });
}
