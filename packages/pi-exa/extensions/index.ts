/**
 * Exa AI extension for pi.
 *
 * Wires bridgekit's portable Exa tools (./tools.ts) into the pi host via
 * bridgekit 0.9.0's registerPiTools adapter. Per-tool pi metadata
 * (promptSnippet, promptGuidelines) lives on each portable tool's
 * `hostExtras.pi` field and is threaded through to pi's `registerTool`
 * call by the adapter; this module no longer maintains a custom
 * dispatch loop.
 *
 * Error semantics: registerPiTools defaults to `errorHandling: "return"`,
 * so portable `isError: true` results and TypeBox validation failures
 * surface as `{ content, details, isError: true }` rather than thrown
 * `PortableToolExecutionError`. This matches bridgekit's MCP adapter.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerPiTools } from "@feniix/bridgekit/pi";
import { getResolvedConfig, isToolEnabledForConfig, resolveAuth } from "./config.js";
import {
  type CycleInspectionFactory,
  type CycleMonitorInspector,
  type CycleRetrievalFactory,
  type CycleSubmissionFactory,
  cyclePiRegistration,
} from "./cycle-pi.js";
import { createExaTools, type ExaToolsOptions, type ExaToolTimeouts } from "./tools.js";
import { getExaRenderers } from "./tui-renderers.js";
import { inspectResearchRun } from "./web-research.js";

export {
  getAuthStatusMessage,
  isToolEnabledForConfig,
  loadConfig,
  parseConfig,
  resolveAuth,
  resolveConfigPath,
} from "./config.js";
export { formatCrawlResults, formatSearchResults } from "./formatters.js";
export { DEFAULT_MAX_CHARACTERS } from "./web-fetch.js";
export { DEFAULT_NUM_RESULTS } from "./web-search.js";

function registerFlags(pi: ExtensionAPI): void {
  pi.registerFlag("exa-enable-cycles", {
    description:
      "Opt in to durable Pi research cycles with operator-approved exploration, compiled Agent research, explicit existing-run GET recovery and explicit funded retry/replacement; unknown-work replacement requires operator duplicate-work/additional-charge consent.",
    type: "boolean",
  });
  pi.registerFlag("exa-api-key", {
    description: "Exa AI API key for search operations",
    type: "string",
  });
  pi.registerFlag("exa-enable-advanced", {
    description: "Enable web_search_advanced_exa tool",
    type: "boolean",
  });
  pi.registerFlag("exa-enable-research", {
    description: "Enable web_research_exa tool",
    type: "boolean",
  });
  pi.registerFlag("exa-config-file", {
    description: "Path to custom JSON config file for private overrides such as API keys.",
    type: "string",
  });
  pi.registerFlag("exa-config", {
    description: "Deprecated alias for --exa-config-file.",
    type: "string",
  });
  pi.registerFlag("exa-timeout-ms", {
    description: "Default per-call timeout in ms for Exa-backed tools. Overrides the built-in 60000 default.",
    type: "string",
  });
  pi.registerFlag("exa-research-timeout-ms", {
    description: "Per-call timeout in ms for web_research_exa Agent runs. Overrides the built-in 180000 default.",
    type: "string",
  });
  pi.registerFlag("exa-monitor-interval-ms", {
    description:
      "First background check delay in ms for guided cycle monitoring; later checks back off x1.5 up to 60000. Built-in default 5000.",
    type: "string",
  });
  pi.registerFlag("exa-submit-timeout-ms", {
    description:
      "Bounded wait in ms for the Exa create acknowledgement in guided cycle submission (researchMode=submit). Expiry leaves the attempt unknown; it never cancels or resubmits. Built-in default 30000.",
    type: "string",
  });
}

function parsePositiveIntFlag(value: string | boolean | undefined): number | undefined {
  if (typeof value !== "string") return undefined;
  const n = Number.parseInt(value.trim(), 10);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return n;
}

function resolvePiTimeouts(pi: ExtensionAPI): ExaToolTimeouts | undefined {
  const def = parsePositiveIntFlag(pi.getFlag("exa-timeout-ms"));
  const research = parsePositiveIntFlag(pi.getFlag("exa-research-timeout-ms"));
  if (def === undefined && research === undefined) return undefined;
  const out: ExaToolTimeouts = {};
  if (def !== undefined) out.default = def;
  if (research !== undefined) out.web_research_exa = research;
  return out;
}

// =============================================================================
// Extension Entry Point
// =============================================================================

export default function exaExtension(pi: ExtensionAPI) {
  registerFlags(pi);

  // Pi applies CLI flag values after extension factories run, so enablement
  // decided here sees only environment and settings files. session_start
  // re-resolves the config with flags and registers any newly enabled tools.
  let resolvedConfig = getResolvedConfig(pi);
  const registered = new Set<string>();
  const buildTools = () =>
    createExaTools({
      resolveApiKey: () => resolveAuth(pi).apiKey || undefined,
      isToolEnabled: (toolName) => isToolEnabledForConfig(pi, resolvedConfig, toolName),
      timeouts: resolvePiTimeouts(pi),
    }).map((tool) => {
      const renderers = getExaRenderers(tool.name);
      if (!renderers.renderCall && !renderers.renderResult) {
        return tool;
      }
      return {
        ...tool,
        hostExtras: {
          ...tool.hostExtras,
          pi: {
            ...tool.hostExtras?.pi,
            ...renderers,
          },
        },
      };
    });
  const registerMissing = (candidates: ReturnType<typeof buildTools>) => {
    const fresh = candidates.filter((tool) => !registered.has(tool.name));
    if (!fresh.length) return;
    registerPiTools(pi, fresh);
    for (const tool of fresh) registered.add(tool.name);
  };
  let tools = buildTools();
  registerMissing(tools);
  let cyclesInstalled = false;
  pi.on("session_start", async (_event, ctx) => {
    // Flags are available now: refresh enablement and register newly enabled tools.
    resolvedConfig = getResolvedConfig(pi);
    tools = buildTools();
    registerMissing(tools);
    if (!cyclesInstalled && pi.getFlag("exa-enable-cycles") === true) {
      const retrievalFactory: CycleRetrievalFactory = (name, usageObserver) => {
        let selected: ReturnType<CycleRetrievalFactory>;
        registerPiTools(
          {
            registerTool: (tool) => {
              selected = tool;
            },
          },
          createExaTools({
            resolveApiKey: () => resolveAuth(pi).apiKey || undefined,
            isToolEnabled: (toolName) => toolName === name && isToolEnabledForConfig(pi, resolvedConfig, toolName),
            timeouts: resolvePiTimeouts(pi),
            usageObserver,
          }),
        );
        return selected;
      };
      const researchFactory = (options: Pick<ExaToolsOptions, "agentInspection" | "agentSubmission">) => {
        let selected: ReturnType<CycleSubmissionFactory>;
        registerPiTools(
          {
            registerTool: (tool) => {
              selected = tool;
            },
          },
          createExaTools({
            resolveApiKey: () => resolveAuth(pi).apiKey || undefined,
            isToolEnabled: (name) => name === "web_research_exa" && isToolEnabledForConfig(pi, resolvedConfig, name),
            timeouts: resolvePiTimeouts(pi),
            ...options,
          }),
        );
        return selected;
      };
      const inspectionFactory: CycleInspectionFactory = (runId, observer) =>
        researchFactory({ agentInspection: { runId, observer } });
      const submissionFactory: CycleSubmissionFactory = (observer) =>
        researchFactory({
          agentSubmission: { observer, createWaitMs: parsePositiveIntFlag(pi.getFlag("exa-submit-timeout-ms")) },
        });
      const monitorInspector: CycleMonitorInspector = (runId, observer, timeoutMs) => {
        const apiKey = resolveAuth(pi).apiKey;
        if (!apiKey) throw Object.assign(new Error("Exa API key is not configured."), { statusCode: 401 });
        return inspectResearchRun(apiKey, runId, { observer, timeoutMs });
      };
      const monitorInterval = parsePositiveIntFlag(pi.getFlag("exa-monitor-interval-ms"));
      const registration = cyclePiRegistration(
        pi,
        retrievalFactory,
        inspectionFactory,
        submissionFactory,
        monitorInspector,
        monitorInterval === undefined ? {} : { initialDelayMs: monitorInterval },
      );
      registerPiTools(registration, tools);
      cyclesInstalled = true;
      // This registration was created inside the current session_start dispatch.
      await registration.sessionStarted(ctx);
    }
  });
}
