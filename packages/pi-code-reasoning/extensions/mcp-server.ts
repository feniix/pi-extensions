/**
 * MCP stdio server module for pi-code-reasoning.
 *
 * Strictly import-passive: exports createMcpServerOptions and runServer
 * for callers. Stdio is started exclusively by bin/pi-code-reasoning.js
 * (which uses @feniix/bridgekit/bin-wrapper to import this module and
 * invoke runServer). Tests import the exports directly without side
 * effects.
 */

import { readFileSync } from "node:fs";
import { type CreateMcpServerOptions, runMcpStdioServer as defaultRunMcpStdioServer } from "@feniix/bridgekit/mcp";
import { isRecord } from "./config.js";
import { createCodeReasoningTools } from "./tools.js";

function readPackageVersion(packageJsonUrl: URL): string | undefined {
  try {
    const packageJson: unknown = JSON.parse(readFileSync(packageJsonUrl, "utf-8"));
    return isRecord(packageJson) && typeof packageJson.version === "string" ? packageJson.version : undefined;
  } catch {
    return undefined;
  }
}

function packageVersion(): string {
  return (
    readPackageVersion(new URL("../package.json", import.meta.url)) ??
    readPackageVersion(new URL("../../package.json", import.meta.url)) ??
    "0.0.0"
  );
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
