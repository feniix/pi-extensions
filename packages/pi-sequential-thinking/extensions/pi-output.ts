/**
 * Pi-side adapter for bridgekit portable tools.
 *
 * This module bridges a host-neutral PortableTool to pi's registerTool
 * signature while preserving the exact return shape the previous inline
 * pi handlers produced: pending update callback, splitParams for
 * piMaxBytes/piMaxLines, formatToolOutput-based truncation with temp-file
 * spillover, and isError:true returned to pi as a tool result rather than
 * thrown via PortableToolExecutionError.
 *
 * We do not use bridgekit's registerPiTools adapter because it throws on
 * isError results; existing pi-side tests for this package assert the
 * returned-isError-result shape.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { executePortableTool, type PortableTool } from "@feniix/bridgekit";
import type { TObject } from "typebox";
import { resolveEffectiveLimits, splitParams } from "./config.js";
import { formatToolOutput, type McpToolDetails } from "./output.js";
import type { ValidationError } from "./types.js";

type PiToolDefinition = Parameters<ExtensionAPI["registerTool"]>[0];

export interface PiToolWrapperOptions {
  pendingMessage: string;
  maxLimits: { maxBytes: number; maxLines: number };
}

function isValidationErrorArray(value: unknown): value is ValidationError[] {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as Record<string, unknown>).field === "string" &&
        typeof (entry as Record<string, unknown>).message === "string",
    )
  );
}

/**
 * Wrap a portable tool into a pi tool definition that preserves the
 * pre-bridgekit observable behavior of the sequential-thinking extension.
 */
export function toPiTool(tool: PortableTool<TObject>, options: PiToolWrapperOptions): PiToolDefinition {
  return {
    name: tool.name,
    label: tool.title,
    description: tool.description,
    parameters: tool.parameters,
    async execute(_toolCallId, params, signal, onUpdate, _ctx) {
      onUpdate?.({
        content: [{ type: "text" as const, text: options.pendingMessage }],
        details: { status: "pending" },
      });

      const rawParams = (params ?? {}) as Record<string, unknown>;
      const { toolArgs, requestedLimits } = splitParams(rawParams);
      const effectiveLimits = resolveEffectiveLimits(requestedLimits, options.maxLimits);

      const portableResult = await executePortableTool(tool, toolArgs, { host: "pi", signal });

      if (portableResult.isError) {
        const structured = (portableResult.structuredContent ?? {}) as Record<string, unknown>;
        const errorMessage = typeof structured.error === "string" ? structured.error : portableResult.text;
        const details: McpToolDetails = {
          tool: tool.name,
          truncated: false,
          error: errorMessage,
        };
        if (isValidationErrorArray(structured.validationErrors)) {
          details.validationErrors = structured.validationErrors;
        }
        return {
          content: [{ type: "text" as const, text: portableResult.text }],
          isError: true,
          details,
        };
      }

      const payload = portableResult.structuredContent ?? portableResult.text;
      const formatted = formatToolOutput(tool.name, payload, effectiveLimits);
      return {
        content: [{ type: "text" as const, text: formatted.text }],
        details: formatted.details,
        isError: false,
      };
    },
  };
}
