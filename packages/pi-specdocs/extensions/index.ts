import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { extractFrontmatterField, parseFrontmatter } from "./frontmatter.js";
import { handleDocLint, runFormat, runValidation } from "./runtime.js";
import { ADR_FILENAME_PATTERN, isAdr, isPlan, isPrd, PLAN_FILENAME_PATTERN, PRD_FILENAME_PATTERN, validateFrontmatter, validateRequiredSections, validateRequiredTables } from "./spec-validation.js";
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
};

export default function specdocs(pi: ExtensionAPI) {
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
