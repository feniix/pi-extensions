import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerPiTools } from "@feniix/bridgekit/pi";
import { type AgentJournalConfig, loadSettings, resolveConfig } from "./config.js";
import { JournalService } from "./journal-service.js";
import { createPiJournalRuntime } from "./pi-runtime.js";
import { JournalStorage } from "./storage.js";
import { createJournalTools } from "./tools.js";

export function createConfiguredJournal(
  config: AgentJournalConfig,
  workspaceRoot: string,
): {
  storage: JournalStorage;
  service: JournalService;
} {
  const storage = new JournalStorage(config.storageDir, { maxBytes: config.maxBytes, maxLines: config.maxLines });
  const service = new JournalService({
    storage,
    workspaceRoot,
    maxEntryBytes: config.maxEntryBytes,
    maxCheckpointBytes: config.maxCheckpointBytes,
  });
  return { storage, service };
}

export default function agentJournal(pi: ExtensionAPI): void {
  pi.registerFlag("--agent-journal-storage-dir", {
    description: "Private local Agent Journal storage directory.",
    type: "string",
  });
  const globalConfig = loadSettings(join(homedir(), ".pi", "agent", "settings.json"));
  const projectConfig = loadSettings(join(process.cwd(), ".pi", "settings.json"));
  const flag = pi.getFlag("--agent-journal-storage-dir");
  const config = resolveConfig(
    {
      ...globalConfig,
      ...projectConfig,
    },
    typeof flag === "string" ? flag : undefined,
  );
  const { storage, service } = createConfiguredJournal(config, process.cwd());
  const runtime = createPiJournalRuntime(pi, { storage, service });
  registerPiTools(
    pi,
    createJournalTools({
      storage,
      service,
      getSelectedSessionId: runtime.getActiveSessionId,
      onSelectSession: runtime.selectSession,
    }),
  );
}

export { JournalService } from "./journal-service.js";
export { JournalStorage } from "./storage.js";
export { createJournalTools } from "./tools.js";
