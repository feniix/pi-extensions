import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import type { RefRuntimeSettings } from "./config.js";
import { formatToolOutput, type McpErrorDetails, resolveEffectiveLimits, splitParams } from "./helpers.js";
import type { RefMcpClient } from "./mcp-client.js";

const searchDocumentationParams = Type.Object(
  {
    query: Type.String({
      description: "Your search query. Include programming language, framework, or library names for best results.",
    }),
    piMaxBytes: Type.Optional(Type.Integer({ description: "Client-side max bytes override (clamped by config)." })),
    piMaxLines: Type.Optional(Type.Integer({ description: "Client-side max lines override (clamped by config)." })),
  },
  { additionalProperties: true },
);

const readUrlParams = Type.Object(
  {
    url: Type.String({ description: "The exact URL of the documentation page to read." }),
    piMaxBytes: Type.Optional(Type.Integer({ description: "Client-side max bytes override (clamped by config)." })),
    piMaxLines: Type.Optional(Type.Integer({ description: "Client-side max lines override (clamped by config)." })),
  },
  { additionalProperties: true },
);

const TOOL_DEFINITIONS = [
  {
    name: "ref_search_documentation",
    label: "Ref Doc Search",
    description:
      "Search technical documentation via Ref.tools; best for API docs, library references, and framework guides. " +
      "Include language/framework names in your query for best results. " +
      "Client-side truncation; override with piMaxBytes/piMaxLines (clamped by config).",
    parameters: searchDocumentationParams,
    pendingMessage: "Searching Ref documentation...",
  },
  {
    name: "ref_read_url",
    label: "Ref Read URL",
    description:
      "Read a documentation URL via Ref.tools and return optimized markdown. " +
      "Pass the exact URL from a ref_search_documentation result or any documentation page. " +
      "Client-side truncation; override with piMaxBytes/piMaxLines (clamped by config).",
    parameters: readUrlParams,
    pendingMessage: "Reading URL via Ref...",
  },
] as const;

const REF_FLAG_DEFINITIONS = [
  ["--ref-mcp-url", { description: "Override the Ref MCP endpoint.", type: "string" }],
  ["--ref-mcp-api-key", { description: "Ref API key (sent as x-ref-api-key header).", type: "string" }],
  ["--ref-mcp-timeout-ms", { description: "HTTP timeout for MCP requests (milliseconds).", type: "string" }],
  [
    "--ref-mcp-protocol",
    { description: "MCP protocol version for initialize() (default: 2025-06-18).", type: "string" },
  ],
  [
    "--ref-mcp-config-file",
    { description: "Path to custom JSON config file for private overrides such as API keys.", type: "string" },
  ],
  ["--ref-mcp-config", { description: "Deprecated alias for --ref-mcp-config-file.", type: "string" }],
  ["--ref-mcp-max-bytes", { description: "Max bytes to keep from tool output (default: 51200).", type: "string" }],
  ["--ref-mcp-max-lines", { description: "Max lines to keep from tool output (default: 2000).", type: "string" }],
] as const;

export function registerRefFlags(pi: ExtensionAPI): void {
  for (const [flag, options] of REF_FLAG_DEFINITIONS) {
    pi.registerFlag(flag, options);
  }
}

export function registerRefTools(
  pi: ExtensionAPI,
  client: RefMcpClient,
  getRuntimeSettings: () => RefRuntimeSettings,
): void {
  for (const definition of TOOL_DEFINITIONS) {
    pi.registerTool({
      name: definition.name,
      label: definition.label,
      description: definition.description,
      parameters: definition.parameters,
      async execute(_toolCallId, params, signal, onUpdate, _ctx) {
        if (signal?.aborted) {
          return { content: [{ type: "text", text: "Cancelled." }], details: { cancelled: true } };
        }

        onUpdate?.({
          content: [{ type: "text", text: definition.pendingMessage }],
          details: { status: "pending" },
        });

        try {
          const runtimeSettings = getRuntimeSettings();
          const { mcpArgs, requestedLimits } = splitParams(params as Record<string, unknown>);
          const effectiveLimits = resolveEffectiveLimits(requestedLimits, {
            maxBytes: runtimeSettings.maxBytes,
            maxLines: runtimeSettings.maxLines,
          });
          const result = await client.callTool(definition.name, mcpArgs, signal);
          const { text, details } = formatToolOutput(
            definition.name,
            runtimeSettings.endpoint,
            result,
            effectiveLimits,
          );
          return { content: [{ type: "text", text }], details, isError: result.isError === true };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: "text", text: `Ref MCP error: ${message}` }],
            isError: true,
            details: {
              tool: definition.name,
              endpoint: client.currentEndpoint(),
              error: message,
            } satisfies McpErrorDetails,
          };
        }
      },
    });
  }
}
