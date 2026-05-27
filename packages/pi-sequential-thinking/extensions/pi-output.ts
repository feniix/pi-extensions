/**
 * Pi-side output policy for sequential-thinking portable tools.
 *
 * Wraps a portable tool with the pi-only concerns RFC §C and §D scope to
 * the consumer:
 *
 *   - Gap C: `splitParams` for `piMaxBytes` / `piMaxLines` overrides.
 *   - Gap D: `formatToolOutput` truncation with tempfile spillover.
 *
 * The wrapper returns a PortableTool of the same shape, so it composes
 * with bridgekit 0.9.0's `registerPiTools` adapter — which handles
 * pendingMessage emission, error-result envelope mapping, and the
 * `structuredContent → details` flow automatically. No custom Pi
 * adapter is required here.
 *
 * Errors short-circuit truncation: handler-returned `isError: true`
 * results pass through unchanged (their text and structuredContent are
 * already the canonical error shape from tools.ts's `toErrorResult`).
 */

import type { PortableTool } from "@feniix/bridgekit";
import type { TObject } from "typebox";
import { resolveEffectiveLimits, splitParams } from "./config.js";
import { formatToolOutput } from "./output.js";

export interface PiOutputWrapperOptions {
  maxLimits: { maxBytes: number; maxLines: number };
}

/**
 * Return a portable tool whose execute applies pi-side argument shaping
 * (splitParams) and output truncation (formatToolOutput) on top of the
 * original portable handler.
 *
 * On success the truncation metadata (`truncated`, `truncation`, `tempFile`)
 * is merged into the original structuredContent so bridgekit's pi adapter
 * surfaces it under `details` for the pi host. The merge is order-safe:
 * tool-provided fields take precedence except for the four
 * formatToolOutput-controlled keys, which authoritatively reflect the
 * truncation pass that just ran.
 */
export function withPiOutput<TParams extends TObject>(
  tool: PortableTool<TParams>,
  options: PiOutputWrapperOptions,
): PortableTool<TParams> {
  const originalExecute = tool.execute;
  return {
    ...tool,
    async execute(args, ctx) {
      const rawArgs = (args ?? {}) as Record<string, unknown>;
      const { toolArgs, requestedLimits } = splitParams(rawArgs);
      const effectiveLimits = resolveEffectiveLimits(requestedLimits, options.maxLimits);

      const result = await originalExecute(toolArgs as typeof args, ctx);

      if (result.isError) {
        // Error path: pass the canonical error shape through unchanged. The
        // text already starts with "Sequential Thinking error: ..." and the
        // structuredContent already carries { kind, tool, error, validationErrors? }.
        return result;
      }

      // Success path: truncate the JSON-serialised result and merge the
      // formatter's McpToolDetails (tool, truncated, optional truncation,
      // optional tempFile) over the tool's structuredContent so pi-side
      // consumers see both.
      const payload = result.structuredContent ?? result.text;
      const formatted = formatToolOutput(tool.name, payload, effectiveLimits);
      return {
        text: formatted.text,
        structuredContent: { ...(result.structuredContent ?? {}), ...formatted.details },
      };
    },
  };
}
