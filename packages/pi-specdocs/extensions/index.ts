import { Type } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { extractFrontmatterField, parseFrontmatter } from "./frontmatter.js";
import { formatPaths, getValidationResult, handleDocLint, runFormat, runValidation } from "./runtime.js";
import {
  ADR_FILENAME_PATTERN,
  isAdr,
  isPlan,
  isPrd,
  PLAN_FILENAME_PATTERN,
  PRD_FILENAME_PATTERN,
  validateFrontmatter,
  validateRequiredSections,
  validateRequiredTables,
  validateSpecFile,
} from "./spec-validation.js";
import { formatConfig, formatSummary, listMatchingFiles, readConfig, scanWorkspace } from "./workspace-scan.js";

export {
  ADR_FILENAME_PATTERN,
  extractFrontmatterField,
  formatConfig,
  formatSummary,
  isAdr,
  isPlan,
  isPrd,
  listMatchingFiles,
  PLAN_FILENAME_PATTERN,
  PRD_FILENAME_PATTERN,
  parseFrontmatter,
  readConfig,
  scanWorkspace,
  validateFrontmatter,
  validateRequiredSections,
  validateRequiredTables,
  validateSpecFile,
};

export default function specdocs(pi: ExtensionAPI) {
  pi.registerTool({
    name: "specdocs_validate",
    label: "Specdocs Validate",
    description:
      "Validate PRD, ADR, and plan documents in the workspace for frontmatter, structure, numbering, and cross-reference issues.",
    promptSnippet: "Validate spec documents after writing or editing PRDs, ADRs, and plans.",
    promptGuidelines: [
      "Use specdocs_validate after creating or editing PRDs, ADRs, or plans to catch structural and numbering issues.",
    ],
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const result = getValidationResult(ctx.cwd);
      return {
        content: [{ type: "text", text: result.message }],
        details: { level: result.level },
        isError: result.level === "error",
      };
    },
  });

  pi.registerTool({
    name: "specdocs_format",
    label: "Specdocs Format",
    description:
      "Format one or more PRD, ADR, or plan documents in place. Supports plain paths, @file references, and simple * globs.",
    promptSnippet: "Normalize spec document formatting for PRDs, ADRs, and plans.",
    promptGuidelines: [
      "Use specdocs_format after editing spec documents when spacing, tables, or section formatting needs normalization.",
      "Use specdocs_format with one or more paths; @file references and simple * globs are supported.",
    ],
    parameters: Type.Object(
      {
        path: Type.Optional(
          Type.String({ description: "Single path to a PRD, ADR, or plan document. Accepts @path/file.md." }),
        ),
        paths: Type.Optional(
          Type.Array(
            Type.String({
              description:
                "One or more document paths. Accepts @path/file.md and simple glob patterns like @docs/adr/ADR-*.md.",
            }),
            { minItems: 1 },
          ),
        ),
        file_path: Type.Optional(Type.String({ description: "Alias for path." })),
      },
      { additionalProperties: true },
    ),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const args =
        params.paths && params.paths.length > 0 ? { paths: params.paths } : params.path || params.file_path || "";
      const results = await formatPaths(args, ctx.cwd);
      const text = results.map((result) => result.message).join("\n");
      const hasError = results.some((result) => result.level === "error");
      return {
        content: [{ type: "text", text }],
        details: {
          results: results.map((result) => ({
            level: result.level,
            path: result.path,
            changed: result.changed,
            message: result.message,
          })),
        },
        isError: hasError,
      };
    },
  });
  pi.on("session_start", async () => {
    const cwd = process.cwd();

    console.log(formatConfig(readConfig(cwd)));

    const summary = formatSummary(scanWorkspace(cwd));
    if (summary) {
      console.log(summary);
    }
  });

  pi.on("tool_result", async (event, ctx) => {
    await handleDocLint(event, ctx);
  });

  pi.registerCommand("specdocs-validate", {
    description:
      "(specdocs plugin) Validate all spec documents for frontmatter completeness, naming conventions, and cross-references",
    handler: async (_args, ctx) => {
      await runValidation(ctx);
    },
  });

  pi.registerCommand("specdocs-format", {
    description: "(specdocs plugin) format a spec document in-process without spawning external tools",
    handler: async (args, ctx) => {
      await runFormat(args, ctx);
    },
  });
}
