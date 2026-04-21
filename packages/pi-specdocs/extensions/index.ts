import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { extractFrontmatterField, parseFrontmatter } from "./frontmatter.js";
import { handleDocLint, runValidation } from "./runtime.js";
import { ADR_FILENAME_PATTERN, isAdr, isPrd, PRD_FILENAME_PATTERN, validateFrontmatter } from "./spec-validation.js";
import { formatConfig, formatSummary, listMatchingFiles, readConfig, scanWorkspace } from "./workspace-scan.js";

export {
  ADR_FILENAME_PATTERN,
  extractFrontmatterField,
  formatConfig,
  formatSummary,
  isAdr,
  isPrd,
  listMatchingFiles,
  PRD_FILENAME_PATTERN,
  parseFrontmatter,
  readConfig,
  scanWorkspace,
  validateFrontmatter,
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
}
