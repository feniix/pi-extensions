import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type CreateMcpServerOptions, runMcpStdioServer } from "@feniix/bridgekit/mcp";
import { assertDistinctStores } from "./config.js";
import { JournalService } from "./journal-service.js";
import { JournalStorage } from "./storage.js";
import { createJournalTools } from "./tools.js";

export interface McpOptionsArgs {
  storageDir?: string;
  piStorageDir?: string;
  workspaceRoot?: string;
  version?: string;
}

function version(): string {
  try {
    const dir = dirname(fileURLToPath(import.meta.url));
    return (JSON.parse(readFileSync(resolve(dir, "..", "..", "package.json"), "utf8")) as { version: string }).version;
  } catch {
    return "0.0.0";
  }
}

export function createMcpServerOptions(args: McpOptionsArgs = {}): CreateMcpServerOptions {
  const piStore = args.piStorageDir ?? process.env.AGENT_JOURNAL_STORAGE_DIR ?? join(homedir(), ".pi_agent_journal");
  const mcpStore =
    args.storageDir ?? process.env.AGENT_JOURNAL_MCP_STORAGE_DIR ?? join(homedir(), ".pi_agent_journal_mcp");
  assertDistinctStores(piStore, mcpStore);
  const storage = new JournalStorage(mcpStore);
  const service = new JournalService({ storage, workspaceRoot: args.workspaceRoot ?? process.cwd() });
  return {
    name: "pi-agent-journal",
    version: args.version ?? version(),
    tools: createJournalTools({ storage, service }),
    instructions:
      "Manual Agent Work Journal capabilities. Record durable operational state, inspect bounded history, create or resume checkpoints, and manage sessions. This MCP server does not observe host turns or inject resume context automatically.",
  };
}

export async function runServer(): Promise<void> {
  await runMcpStdioServer(createMcpServerOptions());
}
