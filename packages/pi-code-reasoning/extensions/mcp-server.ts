#!/usr/bin/env node
import { readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type CreateMcpServerOptions, runMcpStdioServer as defaultRunMcpStdioServer } from "@feniix/bridgekit/mcp";
import { isRecord } from "./config.js";
import { createCodeReasoningTools } from "./tools.js";

function packageVersion(): string {
  const packageJson: unknown = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8"));
  return isRecord(packageJson) && typeof packageJson.version === "string" ? packageJson.version : "0.0.0";
}

export function createMcpServerOptions(): CreateMcpServerOptions {
  return {
    name: "pi-code-reasoning",
    version: packageVersion(),
    tools: createCodeReasoningTools(),
    instructions:
      "Use these tools for reflective sequential thinking with support for branching, revision, status checks, and reset.",
  };
}

type RunMcpStdioServer = (options: CreateMcpServerOptions) => Promise<void>;

export async function runServer(runMcpStdioServer: RunMcpStdioServer = defaultRunMcpStdioServer): Promise<void> {
  await runMcpStdioServer(createMcpServerOptions());
}

function realpathIfPossible(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

if (process.argv[1]) {
  const invokedPath = realpathIfPossible(resolve(process.argv[1]));
  const modulePath = realpathIfPossible(fileURLToPath(import.meta.url));
  if (invokedPath === modulePath) {
    await runServer();
  }
}
